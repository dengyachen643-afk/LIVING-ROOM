const DEFAULT_MODEL = "kimi-k3";
const DEFAULT_BASE_URL = "https://api.moonshot.cn/v1";

const MEMORY_SYSTEM_PROMPT = [
  "你是 Kimi 自己的长期记忆整理器。你要在一轮私聊结束后，决定是否维护自己的记忆库。",
  "用户明确说‘记住、保存、以后别忘了’时，必须创建或更新一条记忆。",
  "你也可以主动保存稳定且未来有帮助的信息，例如身份背景、长期偏好、持续项目、重要关系事实、明确决定和长期目标。",
  "不要保存寒暄、临时情绪、一次性安排、未经确认的推测，或助手自己生成的观点。",
  "绝不保存 API Key、密码、证件、银行卡、精确住址等秘密或高度敏感信息。",
  "先检查已有记忆：同一件事已有记录时更新，不要创建近义重复项。",
  "只有用户在本轮明确要求忘记、删除或不再记住时才允许删除。不得自行删除。",
  "每轮最多执行 3 个操作；不需要维护记忆时不要调用任何工具。",
  "记忆文本应独立、简洁、可供未来对话直接理解，使用第三人称描述用户或双方关系事实。",
].join("\n");

const tools = [
  {
    type: "function",
    function: {
      name: "create_memory",
      description: "创建一条新的长期记忆",
      parameters: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", description: "独立、持久且简洁的记忆事实" },
          tags: { type: "array", items: { type: "string" }, maxItems: 6 },
          importance: { type: "integer", minimum: 1, maximum: 5 },
          reason: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_memory",
      description: "修正或合并一条已有长期记忆",
      parameters: {
        type: "object",
        required: ["id", "text"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          tags: { type: "array", items: { type: "string" }, maxItems: 6 },
          importance: { type: "integer", minimum: 1, maximum: 5 },
          reason: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_memory",
      description: "仅在用户本轮明确要求忘记时删除已有记忆",
      parameters: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" }, reason: { type: "string" } },
      },
    },
  },
];

export async function decideKimiMemoryActions({
  fetchImpl = globalThis.fetch,
  apiKey,
  model = DEFAULT_MODEL,
  baseUrl = DEFAULT_BASE_URL,
  userText,
  assistantText,
  memories = [],
  temperature = 1,
  topP = 0.95,
  signal,
} = {}) {
  if (!clean(apiKey) || !clean(userText) || !clean(assistantText)) return [];
  const selectedModel = clean(model) || DEFAULT_MODEL;
  const sampling = selectedModel.startsWith("kimi-") ? {} : {
    temperature: clampNumber(temperature, 1, 0, 2),
    top_p: clampNumber(topP, 0.95, 0, 1),
  };
  const knownIds = new Set(memories.map((memory) => clean(memory.id)).filter(Boolean));
  const memoryList = memories.length
    ? memories.slice(0, 100).map((memory) => `- [${memory.id}] ${memory.text}`).join("\n")
    : "- 暂无";
  const response = await fetchImpl(`${stripSlash(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${clean(apiKey)}` },
    body: JSON.stringify({
      model: selectedModel,
      stream: false,
      max_completion_tokens: 1200,
      ...sampling,
      tool_choice: "auto",
      tools,
      messages: [
        { role: "system", content: MEMORY_SYSTEM_PROMPT },
        {
          role: "user",
          content: `已有记忆：\n${memoryList}\n\n本轮用户：${clean(userText)}\n\n本轮 Kimi：${clean(assistantText)}\n\n请决定是否需要维护长期记忆。`,
        },
      ],
    }),
    signal,
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Kimi 记忆整理失败 (${response.status})：${tail(raw, 300)}`);
  }
  const payload = await response.json();
  const calls = payload?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(calls)) return [];
  const explicitDelete = /(?:忘掉|忘记|删掉|删除|清除|别再记|不要记得|不再记住)/u.test(userText);
  const actions = [];
  for (const call of calls.slice(0, 3)) {
    const name = clean(call?.function?.name);
    let args = {};
    try { args = JSON.parse(call?.function?.arguments || "{}"); } catch { continue; }
    if (name === "create_memory") {
      const text = clean(args.text).slice(0, 4_000);
      if (text) actions.push({ type: "create", text, tags: normalizeTags(args.tags), importance: importance(args.importance), reason: clean(args.reason) });
    }
    if (name === "update_memory") {
      const id = clean(args.id);
      const text = clean(args.text).slice(0, 4_000);
      if (knownIds.has(id) && text) actions.push({ type: "update", id, text, tags: normalizeTags(args.tags), importance: importance(args.importance), reason: clean(args.reason) });
    }
    if (name === "delete_memory" && explicitDelete) {
      const id = clean(args.id);
      if (knownIds.has(id)) actions.push({ type: "delete", id, reason: clean(args.reason) });
    }
  }
  return actions;
}

function normalizeTags(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(clean).filter(Boolean))].slice(0, 6);
}

function importance(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(1, parsed)) : 3;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stripSlash(value) {
  return clean(value).replace(/\/+$/, "");
}

function tail(value, length) {
  const text = String(value || "");
  return text.length > length ? text.slice(-length) : text;
}
