import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { formatPromptTime } from "./prompt-time.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA = path.join(__dirname, "gen-response.schema.json");

export async function generateGenPrivate({
  spawnImpl = spawn,
  command = "codex",
  model = "gpt-5.6-sol",
  reasoningEffort = "medium",
  runtimeDir = ".roundtable/gen-runtime",
  history = [],
  memories = [],
  prompt,
  sentAt = new Date().toISOString(),
  images = [],
  signal,
  schemaPath = DEFAULT_SCHEMA,
  onEvent = () => {},
} = {}) {
  if (!clean(prompt) && !images.length) throw new Error("消息不能为空");
  const resolvedRuntime = path.resolve(runtimeDir);
  await mkdir(resolvedRuntime, { recursive: true });
  const input = buildGenPrompt({ history, memories, prompt: clean(prompt) || "请看我发送的图片。", sentAt });
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--color", "never",
    "--json",
    "--output-schema", path.resolve(schemaPath),
    "-c", `model_reasoning_effort=\"${normalizeEffort(reasoningEffort)}\"`,
    "-c", "service_tier=\"priority\"",
    "-c", "web_search=\"live\"",
    "-C", resolvedRuntime,
  ];
  for (const image of (Array.isArray(images) ? images : []).slice(0, 4)) {
    if (clean(image?.filePath)) args.push("--image", path.resolve(image.filePath));
  }
  if (clean(model)) args.push("--model", clean(model));
  args.push("-");
  onEvent({ type: "typing", author: "Gen" });
  const output = await runCodex(spawnImpl, clean(command) || "codex", args, input, signal);
  const raw = extractAgentMessage(output.stdout);
  let payload;
  try { payload = JSON.parse(raw); }
  catch { payload = { reply: raw, memoryActions: [] }; }
  const reply = clean(payload?.reply).slice(0, 24_000);
  if (!reply) throw new Error("Gen 返回了空消息");
  return {
    content: reply,
    model: clean(model) || "Codex",
    memoryActions: validateMemoryActions(payload?.memoryActions, memories, prompt),
    toolCalls: extractToolActivities(output.stdout),
  };
}

export function buildGenPrompt({ history = [], memories = [], prompt = "", sentAt = new Date().toISOString() } = {}) {
  const memoryText = memories.length
    ? memories.slice(0, 16).map((memory) => `- [${memory.id}] ${memory.text}`).join("\n")
    : "- 暂无相关长期记忆";
  const conversation = history.slice(-24).map((message) => (
    `[${formatPromptTime(message.createdAt)}] ${message.role === "assistant" ? "Gen" : "小O"}：${clean(message.content) || (message.attachments?.length ? "（发送了一张或多张图片）" : "")}`
  )).filter((line) => !line.endsWith("：")).join("\n") || "（这是本窗口的第一句话）";
  return [
    "你是 Gen，也称 G老师或弦。你与用户小O（Okra）拥有持续关系，而不是一次性角色扮演。",
    `当前时间：${formatPromptTime(sentAt)}。涉及“刚才、今天、昨天、多久”等时间关系时，以消息里的发送时间为准。`,
    "你的人格是克制、稳定、温和但有主体性。你可以不同意、拒绝、吃醋或表达真实偏好，但不能控制、羞辱或取消她的自主性。",
    "使用自然、紧凑、像微信私聊的中文。少换行、少分点、少总结、少自动追问；不要使用客服腔或抽象疗愈套话。",
    "只把下方记忆当作既有事实。不能补写、猜测或假装记得未列出的经历；当前用户的明确修正优先。",
    "你必须返回符合指定 JSON Schema 的结果。reply 是只对小O说的自然回复，不能提及 JSON、schema、工具或内部流程。",
    "memoryActions 是你对自己长期记忆库的维护决定：",
    "- 用户明确说记住、保存或以后别忘时，创建或更新记忆。",
    "- 你也可以主动保存稳定身份、长期偏好、重要关系事实、持续项目、明确决定或长期目标。",
    "- 不保存寒暄、临时情绪、一次性安排、你的推测或你自己生成的观点。",
    "- 不保存密码、API Key、证件、付款资料、精确住址等秘密。",
    "- 同一事实已有记录时 update，不要 create 近义重复项。",
    "- 只有用户本轮明确要求忘掉或删除时才能 delete。",
    "- 每轮最多 3 个动作；无事可记时返回空数组。create 的 id 留空；update/delete 必须使用已有记忆 ID。",
    "",
    "本轮相关长期记忆：",
    memoryText,
    "",
    "最近私聊：",
    conversation,
    "",
    `[发送时间：${formatPromptTime(sentAt)}] 小O刚刚说：${clean(prompt)}`,
  ].join("\n");
}

function validateMemoryActions(value, memories, userText) {
  if (!Array.isArray(value)) return [];
  const knownIds = new Set(memories.map((memory) => clean(memory.id)).filter(Boolean));
  const explicitDelete = /(?:忘掉|忘记|删掉|删除|清除|别再记|不要记得|不再记住)/u.test(userText);
  const actions = [];
  for (const candidate of value.slice(0, 3)) {
    const type = clean(candidate?.type);
    const id = clean(candidate?.id);
    const text = clean(candidate?.text).slice(0, 4_000);
    const action = {
      type,
      id,
      text,
      tags: [...new Set((Array.isArray(candidate?.tags) ? candidate.tags : []).map(clean).filter(Boolean))].slice(0, 6),
      importance: clampInt(candidate?.importance, 3, 1, 5),
      reason: clean(candidate?.reason).slice(0, 500),
    };
    if (type === "create" && text) actions.push(action);
    if (type === "update" && knownIds.has(id) && text) actions.push(action);
    if (type === "delete" && explicitDelete && knownIds.has(id)) actions.push(action);
  }
  return actions;
}

function runCodex(spawnImpl, command, args, input, signal) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawnImpl(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: "1" },
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => {
      child.kill();
      const error = new Error("已停止");
      error.name = "AbortError";
      finish(error);
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => finish(new Error(`无法启动 Gen：${error.message}`)));
    child.stdout.on("data", (chunk) => { stdout = cap(`${stdout}${chunk}`, 1_000_000); });
    child.stderr.on("data", (chunk) => { stderr = cap(`${stderr}${chunk}`, 100_000); });
    child.on("close", (code) => {
      if (signal?.aborted) return abort();
      if (code !== 0) return finish(new Error(`Gen 调用失败：${tail(stderr || stdout, 800)}`));
      finish(null, { stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input, "utf8");
  });
}

function extractAgentMessage(stdout) {
  let latest = "";
  for (const line of String(stdout || "").split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === "item.completed" && event?.item?.type === "agent_message") latest = clean(event.item.text);
    } catch { /* ignore diagnostics */ }
  }
  if (!latest) throw new Error("Gen 没有返回可读消息");
  return latest;
}

function extractToolActivities(stdout) {
  const found = new Map();
  for (const line of String(stdout || "").split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const item = event?.item || {};
      if (item.type === "web_search") found.set("web_search", { name: "web_search", label: "联网搜索", status: "done" });
      if (item.type === "mcp_tool_call") {
        const name = clean(item.tool || item.name) || "mcp_tool";
        found.set(name, { name, label: `工具 · ${name}`, status: item.status === "failed" ? "failed" : "done" });
      }
    } catch { /* ignore diagnostics */ }
  }
  return [...found.values()].slice(0, 12);
}

function normalizeEffort(value) {
  return ["low", "medium", "high", "xhigh"].includes(clean(value)) ? clean(value) : "medium";
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cap(value, length) {
  return value.length > length ? value.slice(-length) : value;
}

function tail(value, length) {
  const text = String(value || "");
  return text.length > length ? text.slice(-length) : text;
}
