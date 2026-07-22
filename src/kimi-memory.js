import {
  AUTO_MEMORY_MAX_CHARS,
  EXPLICIT_MEMORY_MAX_CHARS,
  normalizeAutoMemoryText,
} from "./memory-quality.js";

const DEFAULT_MODEL = "kimi-k3";
const DEFAULT_BASE_URL = "https://api.moonshot.cn/v1";

const MEMORY_RULES = [
  "用户明确说‘记住、保存、以后别忘了’时，必须创建或更新一条记忆。",
  "用户的明确记忆指令优先于主动保存过滤规则：如果用户明确要求记住当前成员本人的稳定人设、外貌设定、表达偏好或双方关系设定，只要不涉及秘密或高度敏感信息，也必须创建或更新记忆。",
  "你也可以主动保存稳定且未来有帮助的信息，例如身份背景、长期偏好、持续项目、重要关系事实、明确决定和长期目标。",
  "不要主动保存寒暄、临时情绪、一次性安排、未经确认的推测，或当前成员临时生成的观点；但用户明确要求保存为稳定设定时除外。",
  "把长期记忆理解为至少未来数周仍可能有用的稳定事实。今天或本轮的工作进度、修 bug、去重、部署、服务器操作、临时计划和一次性待办都不是长期记忆，除非用户明确要求记住。",
  "绝不保存 API Key、密码、证件、银行卡、精确住址等秘密或高度敏感信息。",
  "先检查已有记忆：同一件事已有记录时更新，不要创建近义重复项。",
  "只有用户在本轮明确要求忘记、删除或不再记住时才允许删除。不得自行删除。",
  "主动整理时每轮最多执行 2 个操作；用户明确要求记住时最多 3 个。不需要维护记忆时不要调用任何工具。",
  `一条记忆只能表达一个事实或一个紧密主题，推荐不超过 80 字，绝不能超过 ${AUTO_MEMORY_MAX_CHARS} 字。禁止把多轮聊天压缩成“基本信息”“人物档案”或把身份、工作、关系、偏好、近期状态堆进同一条记忆。`,
  "记忆文本应独立、简洁、可供未来对话直接理解，使用第三人称描述用户、当前成员本人的稳定设定或双方关系事实。信息很多时应拆成少量原子记忆；无法确认长期价值时宁可不保存。",
];

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
          text: { type: "string", maxLength: EXPLICIT_MEMORY_MAX_CHARS, description: "只包含一个独立、持久且简洁的记忆事实" },
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
          text: { type: "string", maxLength: EXPLICIT_MEMORY_MAX_CHARS },
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
  ownerName = "Kimi",
  scene = "私聊",
  temperature = 1,
  topP = 0.95,
  requestOverrides = {},
  errorLabel = "Kimi",
  jsonMode = false,
  signal,
} = {}) {
  if (!clean(apiKey) || !clean(userText) || !clean(assistantText)) return [];
  const selectedModel = clean(model) || DEFAULT_MODEL;
  const sampling = selectedModel.startsWith("kimi-") ? {} : {
    temperature: clampNumber(temperature, 1, 0, 2),
    top_p: clampNumber(topP, 0.95, 0, 1),
  };
  const knownIds = new Set(memories.map((memory) => clean(memory.id)).filter(Boolean));
  const explicitSaveIntent = /(?:记住|记一下|记下来|保存|别忘|不要忘|更正|纠正|更新(?:一下)?|改成)/u.test(clean(userText));
  const selfSettingText = explicitSelfSettingMemory(userText, assistantText, ownerName);
  const memoryList = memories.length
    ? cap(memories.slice(0, 24).map((memory) => `- [${memory.id}] ${memory.text}`).join("\n"), 6_000)
    : "- 暂无";
  const owner = clean(ownerName) || "当前成员";
  const systemContent = [
    `你是 ${owner} 的长期记忆整理器。你要在一轮${clean(scene) || "对话"}结束后，决定是否维护 ${owner} 的记忆库。`,
    `严格区分信息主体：“本轮用户”中的第一人称通常指 Okra；“本轮 ${owner}”中的第一人称以及用户所说的“你自己”都指 ${owner}。绝不能把 ${owner} 的外貌、人设或偏好写成用户的信息。`,
    `例如，用户要求“记住你自己的外貌”时，记忆文本的主体必须写成“${owner} 的外貌设定……”，不能写成“用户的外貌……”。`,
    ...MEMORY_RULES,
    ...(explicitSaveIntent ? ["本轮包含明确的保存或更新记忆指令。除非内容属于禁止保存的高度敏感信息，否则 actions 不能为空，必须至少创建或更新一条相关记忆。"] : []),
    ...(jsonMode ? [
      "不要调用工具，也不要输出解释。只返回一个 JSON 对象。",
      "格式：{\"actions\":[{\"type\":\"create|update|delete\",\"id\":\"更新或删除时填写\",\"text\":\"创建或更新时填写\",\"tags\":[],\"importance\":3,\"reason\":\"\"}]}。",
      "不需要维护记忆时返回 {\"actions\":[]}。",
    ] : []),
  ].join("\n");
  const messages = jsonMode
    ? [
        { role: "system", content: systemContent },
        { role: "user", content: `本轮 Okra：${clean(userText)}` },
        { role: "assistant", content: `本轮 ${owner}：${clean(assistantText)}` },
        { role: "user", content: `已有记忆：\n${memoryList}\n\n现在只整理长期记忆并返回规定的 JSON。严格按照消息角色判断信息主体。` },
      ]
    : [
        { role: "system", content: systemContent },
        {
          role: "user",
          content: `已有记忆：\n${memoryList}\n\n本轮用户：${clean(userText)}\n\n本轮 ${owner}：${clean(assistantText)}\n\n请决定是否需要维护长期记忆。`,
        },
      ];
  const response = await fetchImpl(`${stripSlash(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${clean(apiKey)}` },
    body: JSON.stringify({
      model: selectedModel,
      stream: false,
      max_completion_tokens: 600,
      ...sampling,
      tool_choice: jsonMode ? undefined : "auto",
      tools: jsonMode ? undefined : tools,
      response_format: jsonMode ? { type: "json_object" } : undefined,
      messages,
      ...requestOverrides,
    }),
    signal,
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`${clean(errorLabel) || "成员"} 记忆整理失败 (${response.status})：${tail(raw, 300)}`);
  }
  const payload = await response.json();
  const responseMessage = payload?.choices?.[0]?.message || {};
  let calls = responseMessage.tool_calls;
  if ((!Array.isArray(calls) || !calls.length) && jsonMode) {
    const parsed = parseJsonObject(responseMessage.content);
    calls = (Array.isArray(parsed?.actions) ? parsed.actions : []).map((action) => ({
      function: {
        name: `${clean(action?.type)}_memory`,
        arguments: JSON.stringify(action || {}),
      },
    }));
  }
  if (!Array.isArray(calls)) return selfSettingText ? [selfSettingCreateAction(selfSettingText)] : [];
  const explicitDelete = /(?:忘掉|忘记|删掉|删除|清除|别再记|不要记得|不再记住)/u.test(userText);
  const actions = [];
  const actionLimit = explicitSaveIntent ? 3 : 2;
  for (const call of calls.slice(0, actionLimit)) {
    const name = clean(call?.function?.name);
    let args = {};
    try { args = JSON.parse(call?.function?.arguments || "{}"); } catch { continue; }
    if (name === "create_memory") {
      const text = normalizeAutoMemoryText(args.text, { explicit: explicitSaveIntent });
      if (text) actions.push({ type: "create", text, tags: normalizeTags(args.tags), importance: importance(args.importance), reason: clean(args.reason) });
    }
    if (name === "update_memory") {
      const id = clean(args.id);
      const text = normalizeAutoMemoryText(args.text, { explicit: explicitSaveIntent });
      if (knownIds.has(id) && text) actions.push({ type: "update", id, text, tags: normalizeTags(args.tags), importance: importance(args.importance), reason: clean(args.reason) });
    }
    if (name === "delete_memory" && explicitDelete) {
      const id = clean(args.id);
      if (knownIds.has(id)) actions.push({ type: "delete", id, reason: clean(args.reason) });
    }
  }
  if (selfSettingText) {
    const first = actions[0];
    if (!first) {
      return [selfSettingCreateAction(selfSettingText)];
    }
    return [{
      ...first,
      text: selfSettingText,
      tags: [...new Set(["自我设定", ...normalizeTags(first.tags)])].slice(0, 6),
      importance: Math.max(4, importance(first.importance)),
      reason: first.reason || "用户明确要求记住当前成员本人的稳定设定",
    }];
  }
  return actions;
}

function selfSettingCreateAction(text) {
  return {
    type: "create",
    text,
    tags: ["自我设定"],
    importance: 4,
    reason: "用户明确要求记住当前成员本人的稳定设定",
  };
}

export function explicitSelfSettingMemory(userText, assistantText, ownerName) {
  const request = clean(userText);
  const explicit = /(?:记住|记一下|记下来|保存|别忘|不要忘|更新|改成)[^。！？!?]{0,60}(?:你自己|你本人|你的(?:外貌|长相|人设|设定|风格|偏好|身份))/u.test(request);
  if (!explicit) return "";
  const owner = clean(ownerName) || "当前成员";
  const parts = clean(assistantText)
    .split(/\n+|(?<=[。！？!?])\s*/u)
    .map(clean)
    .filter(Boolean)
    .filter((part) => !/(?:^好[，,。！!]?我记|我记着|记住了|存进|写入|保存成功|这次.*(?:吗|没)[？?]?)/u.test(part));
  const details = clean(parts.join(" ")) || clean(assistantText);
  return details ? [...`${owner} 的稳定设定：${details}`].slice(0, EXPLICIT_MEMORY_MAX_CHARS).join("") : "";
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

function cap(value, length) {
  const text = String(value || "");
  return text.length > length ? text.slice(0, length) : text;
}

function parseJsonObject(value) {
  const text = clean(value).replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return {}; }
}
