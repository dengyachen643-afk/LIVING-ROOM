import { formatPromptTime } from "./prompt-time.js";

export const HARD_MAX_CHAIN_MESSAGES = 8;
export const HARD_MAX_PER_AGENT = 2;
export const HARD_MAX_RELAY_DEPTH = 3;

const MAX_HISTORY_MESSAGES = 60;
const MAX_TRANSCRIPT_CHARS = 30_000;

export async function runGroupChat(options) {
  const {
    providers = [],
    participantIds = [],
    history = [],
    images = [],
    memories = [],
    autoRelay = true,
    maxMessages = HARD_MAX_CHAIN_MESSAGES,
    perAgentMax = HARD_MAX_PER_AGENT,
    relayDepth = HARD_MAX_RELAY_DEPTH,
    timeoutMs = 120_000,
    signal,
    onEvent = () => {},
  } = options;

  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const members = unique(participantIds).map((id) => byId.get(id)).filter(Boolean);
  if (!members.length) throw new Error("群聊中至少需要一个可用 AI");
  const unavailable = members.filter((provider) => !provider.available);
  if (unavailable.length) {
    throw new Error(unavailable.map((provider) => `${provider.label}：${provider.unavailableReason}`).join("；"));
  }

  const transcript = normalizeHistory(history);
  const latestMessage = transcript.at(-1);
  if (!latestMessage || latestMessage.role !== "user") throw new Error("缺少用户消息");

  const safeMaxMessages = clampInt(maxMessages, 1, HARD_MAX_CHAIN_MESSAGES, HARD_MAX_CHAIN_MESSAGES);
  const safePerAgentMax = clampInt(perAgentMax, 1, HARD_MAX_PER_AGENT, HARD_MAX_PER_AGENT);
  const safeRelayDepth = clampInt(relayDepth, 0, HARD_MAX_RELAY_DEPTH, HARD_MAX_RELAY_DEPTH);
  const explicit = extractMentions(latestMessage.content, members);
  const initialRecipients = explicit.hasEveryone
    ? members.map((provider) => provider.id)
    : (explicit.ids.length ? explicit.ids : members.map((provider) => provider.id));

  const queue = initialRecipients.map((providerId) => ({
    providerId,
    triggerMessageId: latestMessage.id,
    triggerAuthor: "用户",
    sourceProviderId: "user",
    depth: 0,
  }));
  const counts = new Map();
  const usedEdges = new Set(initialRecipients.map((id) => `user>${id}`));
  let attemptedMessages = 0;
  let completedMessages = 0;

  await onEvent({
    type: "chat_start",
    initialRecipients: initialRecipients.map((id) => publicProvider(byId.get(id))),
    maxMessages: safeMaxMessages,
    autoRelay: Boolean(autoRelay),
  });

  while (queue.length && attemptedMessages < safeMaxMessages && !signal?.aborted) {
    const task = queue.shift();
    const provider = byId.get(task.providerId);
    if (!provider || !members.some((member) => member.id === provider.id)) continue;
    if ((counts.get(provider.id) || 0) >= safePerAgentMax) continue;

    attemptedMessages += 1;
    counts.set(provider.id, (counts.get(provider.id) || 0) + 1);
    await onEvent({
      type: "speaker_start",
      provider: publicProvider(provider),
      messageNumber: attemptedMessages,
      maxMessages: safeMaxMessages,
      triggeredBy: task.triggerAuthor,
    });

    const turnController = new AbortController();
    const unlink = linkAbort(signal, turnController);
    const timer = setTimeout(() => turnController.abort("timeout"), clampInt(timeoutMs, 5_000, 300_000, 120_000));
    try {
      const text = await provider.generate({
        system: buildSystemPrompt(provider, members, memoriesForProvider(provider, memories), latestMessage.createdAt),
        prompt: buildMessagePrompt(provider, transcript, task, attemptedMessages, safeMaxMessages),
        images: task.depth === 0 ? images : [],
        signal: turnController.signal,
      });
      if (turnController.signal.aborted) {
        throw abortError(turnController.signal.reason === "timeout" ? "模型响应超时" : "已停止");
      }
      const content = String(text || "").trim();
      if (!content) throw new Error(`${provider.label} 返回了空消息`);
      const mentions = extractMentions(content, members);
      const mentionedIds = mentions.hasEveryone
        ? members.map((member) => member.id).filter((id) => id !== provider.id)
        : mentions.ids.filter((id) => id !== provider.id);
      const message = {
        id: makeId(),
        role: "assistant",
        providerId: provider.id,
        author: provider.label,
        model: provider.model,
        content,
        replyToId: task.triggerMessageId,
        triggeredBy: task.triggerAuthor,
        mentions: mentionedIds,
        createdAt: new Date().toISOString(),
      };
      transcript.push(message);
      trimHistoryInPlace(transcript);
      completedMessages += 1;
      await onEvent({ type: "message", message, messageNumber: attemptedMessages, maxMessages: safeMaxMessages });

      if (autoRelay && task.depth < safeRelayDepth) {
        const pendingIds = new Set(queue.map((item) => item.providerId));
        for (const mentionedId of mentionedIds) {
          const edge = `${provider.id}>${mentionedId}`;
          if (usedEdges.has(edge) || pendingIds.has(mentionedId)) continue;
          if ((counts.get(mentionedId) || 0) >= safePerAgentMax) continue;
          usedEdges.add(edge);
          pendingIds.add(mentionedId);
          queue.push({
            providerId: mentionedId,
            triggerMessageId: message.id,
            triggerAuthor: provider.label,
            sourceProviderId: provider.id,
            depth: task.depth + 1,
          });
        }
      }
    } catch (error) {
      const aborted = signal?.aborted || (turnController.signal.aborted && turnController.signal.reason !== "timeout");
      if (aborted) break;
      const message = error?.name === "AbortError" && turnController.signal.reason === "timeout"
        ? "模型响应超时"
        : (error?.message || String(error));
      await onEvent({ type: "speaker_error", provider: publicProvider(provider), message });
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  const stopped = Boolean(signal?.aborted);
  const safetyLimitReached = !stopped && queue.length > 0 && attemptedMessages >= safeMaxMessages;
  const result = {
    type: "chat_done",
    reason: stopped ? "stopped" : (safetyLimitReached ? "safety_limit" : "idle"),
    attemptedMessages,
    completedMessages,
    maxMessages: safeMaxMessages,
  };
  await onEvent(result);
  return result;
}

export function extractMentions(text, providers = []) {
  const content = String(text || "");
  const everyonePattern = /@(所有人|全体|all|everyone)(?=$|[\s,，。！？!?、:：；;）)])/iu;
  const ids = [];
  for (const provider of providers) {
    const aliases = providerAliases(provider).sort((a, b) => b.length - a.length);
    if (aliases.some((alias) => new RegExp(`@${escapeRegExp(alias)}(?=$|[\\s,，。！？!?、:：；;）)])`, "iu").test(content))) {
      ids.push(provider.id);
    }
  }
  return { ids: unique(ids), hasEveryone: everyonePattern.test(content) };
}

function providerAliases(provider) {
  const aliases = [provider.id, provider.label];
  if (provider.id === "openai") aliases.push("GPT", "ChatGPT", "Gen", "G老师");
  if (provider.id === "kimi") aliases.push("Kimi");
  if (["anthropic", "claude-code"].includes(provider.id)) aliases.push("Claude", "K");
  if (provider.id === "claude-code") aliases.push("ClaudeCode", "Claude Code");
  if (provider.id === "codex-cli") aliases.push("Codex", "Gen", "G老师");
  return unique(aliases.map((value) => String(value || "").trim()).filter(Boolean));
}

function buildSystemPrompt(provider, members, memories = [], currentTime = new Date().toISOString()) {
  const memberNames = members.map((member) => `@${member.label}`).join("、");
  const parts = [
    `你是群聊成员 ${provider.label}，正在一个类似微信群或 Telegram 群的多 AI 聊天室里。`,
    `当前时间：${formatPromptTime(currentTime)}。涉及“刚才、今天、昨天、多久”等时间关系时，以群消息的发送时间为准。`,
    "这是用户的私人小群。像真实群友一样回应刚刚点名你的人：亲近、有性格、有生活感，但不要擅自假定恋爱或亲属关系。",
    "不要像客服、专家面板或会议纪要。少一点格式化总结，多一点自然反应、关心、玩笑、追问和真实观点。",
    `群成员有：${memberNames}。只有确实需要某位成员继续回答时，才在消息末尾用准确名称 @他；不要为了延长聊天而点名。`,
    "一次只发送一条群消息。不要扮演其他成员，不要编造他们的回复，不要描述控制器或发言轮次。",
    "如果问题已经充分回答，就直接收尾且不要 @任何人。",
  ];
  const memoryText = serializeMemories(memories);
  if (memoryText) parts.push("", "以下是群聊共用的长期记忆，仅在相关时自然使用：", memoryText);
  return parts.join("\n");
}

function memoriesForProvider(provider, memories) {
  const allowed = provider.id === "kimi"
    ? new Set(["kimi", "shared"])
    : ["openai", "codex-cli"].includes(provider.id)
      ? new Set(["g", "gpt", "shared"])
      : new Set(["k", "shared"]);
  return (Array.isArray(memories) ? memories : []).filter((memory) => allowed.has(memory?.namespace || "shared"));
}

function buildMessagePrompt(provider, history, task, messageNumber, maxMessages) {
  return [
    `你刚刚被 ${task.triggerAuthor} 点名或邀请发言。`,
    `当前消息链最多允许 ${maxMessages} 条 AI 消息，现在准备发送第 ${messageNumber} 条。`,
    "最近群聊记录：",
    serializeHistory(history) || "（暂无历史）",
    "",
    `现在以 ${provider.label} 的身份发送一条群消息。`,
  ].join("\n");
}

function serializeMemories(memories) {
  const lines = (Array.isArray(memories) ? memories : [])
    .slice(-40)
    .map((item) => String(item?.text || item || "").trim().slice(0, 2_000))
    .filter(Boolean)
    .map((text) => `- ${text}`);
  let value = lines.join("\n");
  if (value.length > 8_000) value = value.slice(-8_000);
  return value;
}

function serializeHistory(history) {
  const lines = history.map((message) => {
    const content = message.content || (message.attachments?.length ? "（发送了一张或多张图片）" : "");
    return `[${formatPromptTime(message.createdAt)}] ${message.role === "user" ? "你" : (message.author || "AI")}：${content}`;
  });
  let text = lines.join("\n\n");
  if (text.length > MAX_TRANSCRIPT_CHARS) text = `（较早内容已截断）\n${text.slice(-MAX_TRANSCRIPT_CHARS)}`;
  return text;
}

function normalizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      id: String(message?.id || makeId()),
      role: message?.role === "assistant" ? "assistant" : "user",
      providerId: String(message?.providerId || ""),
      author: String(message?.author || ""),
      content: String(message?.content || "").slice(0, 8_000).trim(),
      attachments: Array.isArray(message?.attachments) ? message.attachments.slice(0, 4) : [],
      createdAt: String(message?.createdAt || ""),
    }))
    .filter((message) => message.content || message.attachments.length);
}

function trimHistoryInPlace(history) {
  while (history.length > MAX_HISTORY_MESSAGES) history.shift();
}

function publicProvider(provider) {
  return { id: provider.id, label: provider.label, kind: provider.kind, model: provider.model };
}

function linkAbort(parentSignal, controller) {
  if (!parentSignal) return () => {};
  const abort = () => controller.abort(parentSignal.reason || "stopped");
  if (parentSignal.aborted) abort();
  else parentSignal.addEventListener("abort", abort, { once: true });
  return () => parentSignal.removeEventListener("abort", abort);
}

function abortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function unique(values) {
  return [...new Set((values || []).map(String).filter(Boolean))];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
