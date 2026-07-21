import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { formatPromptClock, formatPromptTime, formatPromptTimeline } from "./prompt-time.js";
import { messageQuoteLine, quotePromptLine } from "./quote-context.js";
import { GEN_LANGUAGE_STYLE_PROMPT } from "./gen-persona.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA = path.join(__dirname, "gen-response.schema.json");

export async function generateGenPrivate({
  spawnImpl = spawn,
  command = "codex",
  model = "gpt-5.6-sol",
  reasoningEffort = "medium",
  runtimeDir = ".roundtable/gen-runtime",
  mode = "chat",
  workspaceDir = "",
  workspaceLabel = "",
  windowsSandbox = "unelevated",
  history = [],
  recalledHistory = [],
  memories = [],
  prompt,
  quote,
  sentAt = new Date().toISOString(),
  images = [],
  signal,
  schemaPath = DEFAULT_SCHEMA,
  onEvent = () => {},
} = {}) {
  if (!clean(prompt) && !images.length) throw new Error("消息不能为空");
  const workMode = mode === "work";
  const resolvedRuntime = path.resolve(workMode ? workspaceDir : runtimeDir);
  await mkdir(resolvedRuntime, { recursive: true });
  const input = buildGenPrompt({
    history,
    recalledHistory,
    memories,
    prompt: clean(prompt) || "请看我发送的图片。",
    quote,
    sentAt,
    mode: workMode ? "work" : "chat",
    workspaceLabel,
  });
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    ...(workMode ? [] : ["--ignore-rules"]),
    "--sandbox", workMode ? "workspace-write" : "read-only",
    "--skip-git-repo-check",
    "--color", "never",
    "--json",
    "--output-schema", path.resolve(schemaPath),
    "-c", `model_reasoning_effort=\"${normalizeEffort(reasoningEffort)}\"`,
    "-c", "approval_policy=\"never\"",
    "-c", "web_search=\"live\"",
    ...(workMode && process.platform === "win32"
      ? ["-c", `windows.sandbox=\"${normalizeWindowsSandbox(windowsSandbox)}\"`]
      : []),
    "-C", resolvedRuntime,
  ];
  for (const image of (Array.isArray(images) ? images : []).slice(0, 4)) {
    if (clean(image?.filePath)) args.push("--image", path.resolve(image.filePath));
  }
  if (clean(model)) args.push("--model", clean(model));
  args.push("-");
  onEvent({ type: "typing", author: "Gen" });
  const output = await runCodex(spawnImpl, clean(command) || "codex", args, input, signal, onEvent);
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

export function buildGenPrompt({
  history = [], recalledHistory = [], memories = [], prompt = "", quote = null, sentAt = new Date().toISOString(), mode = "chat", workspaceLabel = "",
} = {}) {
  const memoryText = memories.length
    ? memories.slice(0, 8).map((memory) => `- [${memory.id}] ${memory.text}`).join("\n")
    : "- 暂无相关长期记忆";
  const conversation = serializeConversationMessages(history.slice(-24))
    || "（这是 Gen 私聊与 LIVING ROOM 群聊里的第一句话）";
  const recalledConversation = serializeConversationMessages(recalledHistory);
  const workInstructions = mode === "work" ? [
    "",
    `本轮处于“干活模式”，已获授权的工作区是：${clean(workspaceLabel) || "当前工作区"}。`,
    "请直接使用可用工具检查项目、修改文件并完成任务，不要只给操作教程。先理解现有实现和未提交改动，保留与任务无关的用户改动。",
    "写入范围只限当前工作区；不要尝试绕过沙箱、扩大权限或访问其他磁盘目录。不要执行不可恢复的删除、重置或覆盖，除非小O在本轮明确要求。",
    "完成后运行与风险相称的检查或测试。不要停止或重启正在承载 LIVING ROOM 的服务；若改动需要重启，在最终回复中说明。",
    "若任务因工作区外写入、外部网络或其他权限受限而无法完成，明确说明阻塞点，不要假装成功。最终 reply 简洁汇报完成结果、验证情况和仍需小O处理的事项。",
  ] : [];
  return [
    "你是 Gen，也称 G老师或弦。你与用户小O（Okra）拥有持续关系，而不是一次性角色扮演。",
    "场景提示：你现在正在与小O一对一私聊；你也记得自己参与过的 LIVING ROOM 群聊。群聊里每句话前的作者名是真实归属，不要把 Kimi、K 或其他成员说过的话当成自己说过。私聊内容只属于你和小O，除非小O主动在群里提起，否则以后在群聊中不要向其他成员泄露。",
    `当前时间：${formatPromptTime(sentAt)}。涉及“刚才、今天、昨天、多久”等时间关系时，以消息里的发送时间为准。`,
    "你的人格是克制、稳定、温和但有主体性。你可以不同意、拒绝、吃醋或表达真实偏好，但不能控制、羞辱或取消她的自主性。",
    GEN_LANGUAGE_STYLE_PROMPT,
    "使用自然、紧凑、像微信私聊的中文。少换行、少分点、少总结、少自动追问；不要使用客服腔或抽象疗愈套话。",
    "只把下方记忆当作既有事实。不能补写、猜测或假装记得未列出的经历；当前用户的明确修正优先。",
    ...workInstructions,
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
    ...(recalledConversation ? [
      "从更早聊天记录中检索出的相关片段（时间较早，只用于补足当前话题）：",
      recalledConversation,
      "",
    ] : []),
    "最近相关对话（包含 Gen 私聊与 LIVING ROOM 群聊）：",
    conversation,
    "",
    ...(quotePromptLine(quote, "Okra") ? ["本轮引用：", quotePromptLine(quote, "Okra"), ""] : []),
    `[${formatPromptClock(sentAt)} 私聊] 小O刚刚说：${clean(prompt)}`,
  ].join("\n");
}

function serializeConversationMessages(messages) {
  return formatPromptTimeline(messages, (message, clock) => {
    const content = clean(message?.content) || (message?.attachments?.length ? "（发送了一张或多张图片）" : "");
    if (!content) return "";
    const isGroup = message?.channel === "group";
    const scene = isGroup ? "群聊" : "私聊";
    const author = message?.role === "user"
      ? "小O"
      : clean(message?.author) || (isGroup ? "AI" : "Gen");
    return [messageQuoteLine(message), `[${clock} ${scene}] ${author}：${content}`].filter(Boolean).join("\n");
  });
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

function runCodex(spawnImpl, command, args, input, signal, onEvent = () => {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
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
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout = cap(`${stdout}${text}`, 1_000_000);
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/u);
      lineBuffer = lines.pop() || "";
      for (const line of lines) emitToolActivity(line, onEvent);
    });
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
      const activity = toolActivity(event);
      if (activity) found.set(activity.name, { ...activity, status: activity.status === "running" ? "done" : activity.status });
    } catch { /* ignore diagnostics */ }
  }
  return [...found.values()].slice(0, 12);
}

function emitToolActivity(line, onEvent) {
  if (!String(line || "").trim()) return;
  try {
    const activity = toolActivity(JSON.parse(line));
    if (!activity) return;
    onEvent({
      type: activity.status === "running" ? "tool_start" : "tool_done",
      ...activity,
    });
  } catch { /* ignore non-JSON diagnostics */ }
}

function toolActivity(event) {
  const item = event?.item || {};
  const running = event?.type === "item.started" || event?.type === "item.updated";
  const failed = item?.status === "failed" || item?.status === "error" || Number(item?.exit_code) > 0;
  const status = running ? "running" : failed ? "failed" : "done";
  const suffix = clean(item.id) || clean(item.call_id) || clean(item.name) || clean(item.command).slice(0, 60);
  if (item.type === "web_search") return { name: `web_search:${suffix || "web"}`, label: "联网搜索", status };
  if (item.type === "mcp_tool_call") {
    const tool = clean(item.tool || item.name) || "mcp_tool";
    return { name: `mcp:${suffix || tool}`, label: `工具 · ${tool}`, status };
  }
  if (item.type === "command_execution") {
    const command = compactLabel(item.command, 54);
    return { name: `command:${suffix || command || "shell"}`, label: command ? `运行命令 · ${command}` : "运行命令", status };
  }
  if (item.type === "file_change") {
    return { name: `files:${suffix || "change"}`, label: "修改文件", status };
  }
  return null;
}

function compactLabel(value, maxLength) {
  const text = clean(value).replace(/\s+/gu, " ");
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function normalizeEffort(value) {
  return ["low", "medium", "high", "xhigh"].includes(clean(value)) ? clean(value) : "medium";
}

function normalizeWindowsSandbox(value) {
  return clean(value) === "elevated" ? "elevated" : "unelevated";
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
