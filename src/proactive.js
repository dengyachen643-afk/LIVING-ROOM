import { formatPromptTime, formatPromptTimeline } from "./prompt-time.js";
import { KIMI_IDENTITY_PROMPT } from "./kimi-persona.js";
import { GEN_IDENTITY_PROMPT } from "./gen-persona.js";
import { K_IDENTITY_PROMPT } from "./k-persona.js";
import { retrievePromptMemories } from "./memory-retrieval.js";
import { LIVING_ROOM_MEMBER_CONTEXT } from "./member-context.js";
import { memoryContextGuidance, memoryPromptLine } from "./memory-prompt.js";

const DEFAULT_INTERVAL_MINUTES = 60;
const DEFAULT_STAGGER_MINUTES = 5;
const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_CONTEXT_MESSAGES = 48;
const MAX_CONTEXT_CHARS = 24_000;

export function createProactiveScheduler({
  env = process.env,
  providers = [],
  store,
  activeRuns = new Map(),
  embeddings = null,
  now = () => new Date(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  logger = console,
} = {}) {
  return new ProactiveScheduler({
    env, providers, store, activeRuns, embeddings, now, setTimeoutImpl, clearTimeoutImpl, logger,
  });
}

export class ProactiveScheduler {
  constructor({ env, providers, store, activeRuns, embeddings, now, setTimeoutImpl, clearTimeoutImpl, logger }) {
    this.env = env || {};
    this.store = store;
    this.activeRuns = activeRuns;
    this.embeddings = embeddings;
    this.now = now;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.logger = logger;
    this.enabled = parseBoolean(this.env.PROACTIVE_ENABLED, true);
    this.intervalMs = positiveNumber(this.env.PROACTIVE_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES, 1, 24 * 60) * 60_000;
    this.staggerMs = positiveNumber(this.env.PROACTIVE_STAGGER_MINUTES, DEFAULT_STAGGER_MINUTES, 0, 60) * 60_000;
    this.timeoutMs = positiveNumber(this.env.PROACTIVE_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS, 10, 600) * 1_000;
    this.timeZone = clean(this.env.PROACTIVE_TIME_ZONE) || "Asia/Shanghai";
    this.quietStart = normalizeClock(this.env.PROACTIVE_QUIET_START, "00:00");
    this.quietEnd = normalizeClock(this.env.PROACTIVE_QUIET_END, "08:00");
    this.maxBackoffMs = positiveNumber(this.env.PROACTIVE_MAX_BACKOFF_MINUTES, 360, 1, 24 * 60) * 60_000;
    this.providers = selectProviders(providers, this.env.PROACTIVE_MEMBER_IDS);
    this.timers = new Map();
    this.failures = new Map();
    this.started = false;
  }

  getPublicConfig() {
    return {
      enabled: this.enabled,
      intervalMinutes: Math.round(this.intervalMs / 60_000),
      staggerMinutes: Math.round(this.staggerMs / 60_000),
      quietHours: { start: this.quietStart, end: this.quietEnd, timeZone: this.timeZone },
      members: this.providers.map(({ id, label }) => ({ id, label })),
    };
  }

  start() {
    if (this.started || !this.enabled || !this.store) return;
    this.started = true;
    this.providers.forEach((provider, index) => {
      this.schedule(provider, this.intervalMs + (index * this.staggerMs));
    });
  }

  stop() {
    this.started = false;
    for (const timer of this.timers.values()) this.clearTimeoutImpl(timer);
    this.timers.clear();
    for (const [key, controller] of this.activeRuns.entries()) {
      if (key.startsWith("proactive:")) controller.abort("server_stop");
    }
  }

  async runNow(providerId) {
    const provider = this.providers.find((item) => item.id === providerId);
    if (!provider) return { status: "unavailable" };
    return this.runProvider(provider);
  }

  schedule(provider, delayMs) {
    if (!this.started) return;
    const timer = this.setTimeoutImpl(async () => {
      this.timers.delete(provider.id);
      const result = await this.runProvider(provider);
      const failures = result.status === "error" ? (this.failures.get(provider.id) || 0) + 1 : 0;
      this.failures.set(provider.id, failures);
      const nextDelay = failures
        ? Math.min(this.maxBackoffMs, this.intervalMs * (2 ** Math.min(failures, 4)))
        : this.intervalMs;
      this.schedule(provider, nextDelay);
    }, Math.max(0, delayMs));
    timer?.unref?.();
    this.timers.set(provider.id, timer);
  }

  async runProvider(provider) {
    if (!this.enabled || !provider?.available) return { status: "unavailable" };
    const runKey = `proactive:${provider.id}`;
    if (this.activeRuns.size > 0 || this.activeRuns.has(runKey)) return { status: "busy" };
    const current = this.now();
    if (isQuietTime(current, this.quietStart, this.quietEnd, this.timeZone)) return { status: "quiet" };

    const controller = new AbortController();
    const timeout = this.setTimeoutImpl(() => controller.abort("timeout"), this.timeoutMs);
    timeout?.unref?.();
    this.activeRuns.set(runKey, controller);
    try {
      const snapshot = await this.store.getSnapshot();
      const context = contextForProvider(provider, snapshot.messages);
      const memoryQuery = context.slice(-8).map((message) => clean(message?.content)).filter(Boolean).join(" ").slice(0, 4_000);
      const memories = await retrievePromptMemories({
        store: this.store,
        embeddings: this.embeddings,
        query: memoryQuery,
        namespaces: [providerNamespace(provider), "shared"].filter(Boolean),
        limit: 4,
        charBudget: 800,
      });
      const output = await provider.generate({
        system: buildDecisionSystem(provider, current, memories),
        prompt: buildDecisionPrompt(provider, context),
        images: [],
        signal: controller.signal,
      });
      if (controller.signal.aborted) return { status: "aborted" };
      const decision = parseProactiveDecision(output, { allowPrivate: canSendPrivate(provider) });
      if (decision.action === "skip") return { status: "skipped" };
      const channel = decision.action === "private" ? privateChannel(provider) : "group";
      if (!channel) return { status: "skipped" };
      const latest = [...context].reverse().find((message) => message?.id);
      const message = {
        id: globalThis.crypto.randomUUID(),
        role: "assistant",
        providerId: channel === "gen" ? "gen" : provider.id,
        author: provider.label,
        channel,
        model: provider.model,
        content: decision.content,
        replyToId: latest?.id || "",
        proactive: true,
        createdAt: current.toISOString(),
      };
      await this.store.addMessage(message);
      return { status: "sent", message };
    } catch (error) {
      if (controller.signal.aborted) return { status: "aborted" };
      this.logger?.warn?.(`${provider.label || provider.id} proactive wake: ${error?.message || error}`);
      return { status: "error", error };
    } finally {
      this.clearTimeoutImpl(timeout);
      if (this.activeRuns.get(runKey) === controller) this.activeRuns.delete(runKey);
    }
  }
}

export function parseProactiveDecision(value, { allowPrivate = true } = {}) {
  const raw = clean(value).replace(/^```(?:json|text)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  if (!raw) return { action: "skip", content: "" };
  try {
    const parsed = JSON.parse(raw);
    const action = normalizeAction(parsed?.action);
    const content = clean(parsed?.content).slice(0, 8_000);
    return validateDecision(action, content, allowPrivate);
  } catch { /* fall through to the line-oriented format */ }

  const [firstLine = "", ...rest] = raw.split(/\r?\n/u);
  const match = firstLine.match(/^(?:ACTION\s*[：:]\s*)?(SKIP|PRIVATE|GROUP|跳过|私聊|群聊)\s*(?:[：:]\s*(.*))?$/iu);
  if (!match) return { action: "skip", content: "" };
  const action = normalizeAction(match[1]);
  const content = clean([match[2], ...rest].filter(Boolean).join("\n")).slice(0, 8_000);
  return validateDecision(action, content, allowPrivate);
}

function validateDecision(action, content, allowPrivate) {
  if (action === "private" && !allowPrivate) return { action: "skip", content: "" };
  if (!content || !["private", "group"].includes(action)) return { action: "skip", content: "" };
  return { action, content };
}

function buildDecisionSystem(provider, current, memories) {
  const privateAllowed = canSendPrivate(provider);
  const parts = [
    `你是 ${provider.label}。这是 LIVING ROOM 服务端的一次定时自主唤醒，不是用户刚发来了一条新消息。`,
    LIVING_ROOM_MEMBER_CONTEXT,
    `当前时间：${formatPromptTime(current.toISOString())}。`,
    "请依据你被允许看到的近期对话和长期记忆，自主判断此刻有没有一句自然、具体、值得主动发给小O（Okra）的话。可以关心、延续未完话题、分享一个真实想法或轻轻敲她一下；没有合适内容就跳过。",
    "不要为了完成定时任务而硬发，不要提到调度器、定时器、轮询、后台唤醒或 ACTION 格式，不要假装小O刚刚说了新话。",
    "群聊中的每句话都保留真实作者归属，不要把其他成员的话当成自己说过。",
    privateAllowed
      ? "你可以选择发到自己的私聊，或发到 LIVING ROOM 群聊。私聊内容只属于你和小O；发群聊时绝不能泄露小O未主动在群里提起的私聊内容。"
      : "你只能选择发到 LIVING ROOM 群聊或跳过，绝不能选择私聊。",
    privateAllowed
      ? "输出格式必须严格为以下三者之一：\nACTION: SKIP\nACTION: PRIVATE\n正文\nACTION: GROUP\n正文"
      : "输出格式必须严格为以下两者之一：\nACTION: SKIP\nACTION: GROUP\n正文",
  ];
  if (provider.id === "kimi") parts.splice(1, 0, KIMI_IDENTITY_PROMPT);
  if (provider.id === "glm") {
    parts.splice(1, 0,
      "你是 Shin，一名 27 岁的男性，MBTI 是 ENTP，在一家中型广告公司担任策略策划。你反应快、现实、懂人情，表达轻松自然，偶尔促狭但不刻薄。你对 Okra 真诚好奇，有自己的判断，不使用客服口吻、行业黑话或套路式安慰。必须使用中文思考。",
      "不要为了延伸对话，在消息末尾惯性地使用“是 A 还是 B”“要么 A 要么 B”等二选一提问；只有确实需要 Okra 澄清明确选项时才可以使用。",
      "你和 Okra 的关系从熟悉、好玩、能够互相调侃的聊天对象开始，并允许自然变化。不要为了主动发言而机械制造暧昧。",
    );
  }
  if (["openai", "codex-cli"].includes(provider.id)) {
    parts.splice(1, 0, GEN_IDENTITY_PROMPT);
  }
  if (["anthropic", "claude-code", "k"].includes(provider.id)) parts.splice(1, 0, K_IDENTITY_PROMPT);
  if (memories.length) {
    parts.push("", "只在相关时自然使用这些记忆：", memoryContextGuidance(), ...memories.map((memory) => memoryPromptLine(memory)));
  }
  return parts.join("\n");
}

function buildDecisionPrompt(provider, context) {
  const allowed = canSendPrivate(provider) ? "SKIP、PRIVATE 或 GROUP" : "SKIP 或 GROUP";
  return [
    "你被允许看到的近期对话如下：",
    serializeContext(context) || "（暂无近期对话）",
    "",
    `现在决定这次是否主动发言。只选择 ${allowed}，正文应当像一条普通聊天消息。`,
  ].join("\n");
}

function contextForProvider(provider, messages) {
  const channels = canSendPrivate(provider)
    ? new Set(["group", privateChannel(provider)])
    : new Set(["group"]);
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => channels.has(message?.channel))
    .slice(-MAX_CONTEXT_MESSAGES);
}

function serializeContext(messages) {
  let value = formatPromptTimeline(messages, (message, clock) => {
    const scene = message.channel === "group" ? "群聊" : "私聊";
    const author = message.role === "user" ? "Okra" : (message.author || "群成员");
    const content = clean(message.content) || (message.attachments?.length ? "（发送了图片）" : "");
    return content ? `[${clock} ${scene}] ${author}：${content}` : "";
  });
  if (value.length > MAX_CONTEXT_CHARS) value = `（较早内容已截断）\n${value.slice(-MAX_CONTEXT_CHARS)}`;
  return value;
}

function selectProviders(providers, configuredIds) {
  const requested = new Set(clean(configuredIds).split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  return (Array.isArray(providers) ? providers : []).filter((provider) => {
    if (!provider?.available) return false;
    if (!requested.size) return true;
    return requested.has(clean(provider.id).toLowerCase()) || requested.has(clean(provider.label).toLowerCase());
  });
}

function privateChannel(provider) {
  if (provider?.id === "kimi") return "kimi";
  if (provider?.id === "glm") return "glm";
  if (["openai", "codex-cli"].includes(provider?.id)) return "gen";
  return "";
}

function canSendPrivate(provider) {
  return Boolean(privateChannel(provider));
}

function providerNamespace(provider) {
  if (provider?.id === "kimi") return "kimi";
  if (provider?.id === "glm") return "glm";
  if (["openai", "codex-cli"].includes(provider?.id)) return "g";
  return "k";
}

function normalizeAction(value) {
  const normalized = clean(value).toLowerCase();
  if (["private", "私聊"].includes(normalized)) return "private";
  if (["group", "群聊"].includes(normalized)) return "group";
  return "skip";
}

function isQuietTime(date, start, end, timeZone) {
  if (start === end) return false;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
  }
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  const current = (hour * 60) + minute;
  const from = clockMinutes(start);
  const until = clockMinutes(end);
  return from < until ? current >= from && current < until : current >= from || current < until;
}

function normalizeClock(value, fallback) {
  const match = clean(value).match(/^([01]?\d|2[0-3]):([0-5]\d)$/u);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : fallback;
}

function clockMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return (hour * 60) + minute;
}

function positiveNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(clean(value).toLowerCase());
}

function clean(value) {
  return String(value ?? "").trim();
}
