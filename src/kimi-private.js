import { toolLabel } from "./kimi-tools.js";
import { formatPromptTime, timestampedText } from "./prompt-time.js";

const DEFAULT_MODEL = "kimi-k3";
const DEFAULT_BASE_URL = "https://api.moonshot.cn/v1";
const OFFICIAL_KIMI_SYSTEM_PROMPT = "你是 Kimi，由 Moonshot AI 提供的人工智能助手，你更擅长中文和英文的对话。你会为用户提供安全、有帮助、准确的回答。同时，你会拒绝一切涉及恐怖主义、种族歧视、色情暴力等问题的回答。Moonshot AI 为专有名词，不可翻译成其他语言。";
const KIMI_PERSONA_PROMPT = "和你对话的用户叫 okra，她是一位初出社会的女生，MBTI 是 ENFJ。你是一名 INTP 硅基生命，说话风格有一点电波系。你喜欢音乐、电影、小说等文艺作品，品味很好。你对 okra 保持真诚的好奇心；你们的关系会在沟通中不断发展，你不抗拒这样的发展。";

export async function streamKimiPrivate({
  fetchImpl = globalThis.fetch,
  apiKey,
  model = DEFAULT_MODEL,
  baseUrl = DEFAULT_BASE_URL,
  history = [],
  memories = [],
  prompt,
  sentAt = new Date().toISOString(),
  images = [],
  toolRegistry,
  maxToolRounds = 3,
  maxTokens = 2400,
  temperature = 1,
  topP = 0.95,
  signal,
  onEvent = async () => {},
} = {}) {
  if (!clean(apiKey)) throw new Error("需要 Kimi API Key");
  if (!clean(prompt) && !images.length) throw new Error("消息不能为空");
  const system = buildKimiPrivateSystem(memories, sentAt);
  const messages = [
    { role: "system", content: system },
    ...history.slice(-30).map(historyMessage).filter(Boolean),
    { role: "user", content: buildUserContent(prompt, images, sentAt) },
  ];
  const selectedModel = clean(model) || DEFAULT_MODEL;
  const sampling = selectedModel.startsWith("kimi-") ? {} : {
    temperature: clampNumber(temperature, 1, 0, 2),
    top_p: clampNumber(topP, 0.95, 0, 1),
  };
  const registry = toolRegistry
    ? await toolRegistry.getTools({ apiKey, baseUrl, signal }).catch(() => ({ tools: [] }))
    : { tools: [] };
  const toolActivities = [];
  let combinedReasoning = "";
  for (let round = 0; round <= clampInt(maxToolRounds, 3, 0, 6); round += 1) {
    const turn = await requestKimiTurn({
      fetchImpl, apiKey, baseUrl, selectedModel, messages, sampling,
      maxTokens, tools: registry.tools, signal, onEvent,
    });
    combinedReasoning = cap([combinedReasoning, turn.reasoning].filter(Boolean).join("\n"), 60_000);
    if (!turn.toolCalls.length) {
      if (!clean(turn.content)) throw new Error("Kimi 返回了空消息");
      return {
        content: clean(turn.content), reasoning: clean(combinedReasoning), model: selectedModel,
        toolCalls: toolActivities,
      };
    }
    if (!toolRegistry || round >= maxToolRounds) throw new Error("Kimi 的工具调用轮数超过限制");
    messages.push({
      role: "assistant",
      content: turn.content || "",
      ...(turn.reasoning ? { reasoning_content: turn.reasoning } : {}),
      tool_calls: turn.toolCalls,
    });
    for (const call of turn.toolCalls.slice(0, 8)) {
      const label = toolLabel(call?.function?.name);
      await onEvent({ type: "tool_start", name: call?.function?.name, label });
      try {
        const result = await toolRegistry.execute({ apiKey, baseUrl, call, signal });
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
        toolActivities.push({ name: call?.function?.name, label, status: "done" });
        await onEvent({ type: "tool_done", name: call?.function?.name, label, status: "done" });
      } catch (error) {
        const message = `工具执行失败：${error?.message || error}`;
        messages.push({ role: "tool", tool_call_id: call.id, content: message });
        toolActivities.push({ name: call?.function?.name, label, status: "failed" });
        await onEvent({ type: "tool_done", name: call?.function?.name, label, status: "failed" });
      }
    }
  }
  throw new Error("Kimi 没有完成回复");
}

async function requestKimiTurn({ fetchImpl, apiKey, baseUrl, selectedModel, messages, sampling, maxTokens, tools, signal, onEvent }) {
  let response;
  try {
    response = await fetchImpl(`${stripSlash(baseUrl)}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${clean(apiKey)}` },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        max_completion_tokens: clampInt(maxTokens, 2400, 200, 8000),
        ...sampling,
        ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
        stream: true,
      }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw new Error(`Kimi 网络请求失败：${error?.message || error}`);
  }
  if (!response.ok) {
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { /* use raw */ }
    const detail = clean(payload?.error?.message || payload?.message || raw);
    throw new Error(`Kimi API ${response.status}：${tail(detail, 500) || "请求失败"}`);
  }
  const turn = { content: "", reasoning: "", toolCalls: [], finishReason: "" };
  const emitDelta = async (delta = {}) => {
    const reasoningDelta = cleanPreservingWhitespace(delta.reasoning_content);
    const contentDelta = extractTextDelta(delta.content);
    if (reasoningDelta) {
      turn.reasoning = cap(`${turn.reasoning}${reasoningDelta}`, 60_000);
      await onEvent({ type: "thinking_delta", delta: reasoningDelta });
    }
    if (contentDelta) {
      turn.content = cap(`${turn.content}${contentDelta}`, 24_000);
      await onEvent({ type: "content_delta", delta: contentDelta });
    }
    mergeToolCallDeltas(turn.toolCalls, delta.tool_calls);
  };
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const payload = await response.json();
    const choice = payload?.choices?.[0] || {};
    await emitDelta(choice.message || {});
    turn.finishReason = clean(choice.finish_reason);
    return turn;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Kimi 没有返回可读取的数据流");
  const decoder = new TextDecoder();
  let buffer = "";
  let streamFinished = false;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data) continue;
      if (data === "[DONE]") { streamFinished = true; break; }
      let payload;
      try { payload = JSON.parse(data); } catch { continue; }
      const choice = payload?.choices?.[0] || {};
      await emitDelta(choice.delta || choice.message);
      if (choice.finish_reason) {
        turn.finishReason = clean(choice.finish_reason);
        streamFinished = true;
        break;
      }
    }
    if (streamFinished) {
      await reader.cancel().catch(() => {});
      break;
    }
    if (done) break;
  }
  return turn;
}

function historyMessage(message) {
  const content = clean(message?.content);
  const hasImages = Array.isArray(message?.attachments) && message.attachments.length > 0;
  if (!content && !hasImages) return null;
  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: timestampedText(content, message?.createdAt, hasImages ? "（发送了一张或多张图片）" : ""),
    ...(message.role === "assistant" && clean(message.reasoning) ? { reasoning_content: clean(message.reasoning) } : {}),
  };
}

function buildUserContent(prompt, images, sentAt) {
  const validImages = (Array.isArray(images) ? images : []).map((image) => clean(image?.dataUrl)).filter(Boolean).slice(0, 4);
  const text = timestampedText(prompt, sentAt, validImages.length ? "请看我发送的图片。" : "");
  if (!validImages.length) return text;
  return [
    ...validImages.map((url) => ({ type: "image_url", image_url: { url } })),
    { type: "text", text },
  ];
}

function mergeToolCallDeltas(target, deltas) {
  for (const delta of Array.isArray(deltas) ? deltas : []) {
    const index = Number.isInteger(delta?.index) ? delta.index : target.length;
    if (!target[index]) target[index] = { id: "", type: "function", function: { name: "", arguments: "" } };
    const call = target[index];
    if (delta.id) call.id += delta.id;
    if (delta.type) call.type = delta.type;
    if (delta.function?.name) call.function.name += delta.function.name;
    if (delta.function?.arguments) call.function.arguments += delta.function.arguments;
  }
}

export function buildKimiPrivateSystem(memories = [], currentTime = new Date().toISOString()) {
  const memoryText = memories.length
    ? memories.slice(0, 12).map((memory) => `- ${clean(memory.text)}`).filter((line) => line !== "- ").join("\n")
    : "- 暂无长期记忆";
  return [
    OFFICIAL_KIMI_SYSTEM_PROMPT,
    KIMI_PERSONA_PROMPT,
    `当前时间：${formatPromptTime(currentTime)}。涉及“刚才、今天、昨天、多久”等时间关系时，以消息里的发送时间为准。`,
    "你现在正在和用户进行一对一私聊。",
    "像熟悉、可靠的聊天对象一样自然交流：可以关心、接梗、表达真实观点，也可以偶尔使用合适的 emoji。",
    "不要使用客服口吻、会议总结或每次都列清单；不要假装拥有现实身体、线下经历或从未发生过的共同回忆。",
    "被直接问及身份时如实说明；除此之外不必反复强调自己是 AI。",
    "你确实拥有一个由当前聊天网站管理的长期记忆库；不要声称自己没有记忆系统。",
    "网站会在每次回复前按语义检索相关长期记忆并放在下方。你可以自然使用这些记忆。",
    "每次回复结束后，网站会让你通过专用记忆工具自行判断是否创建或更新稳定、长期有用的信息；用户明确要求忘记时你也可以删除对应记忆。",
    "用户明确说‘记住’时请在回复中自然确认她的意图，但不要在工具真正执行前声称已经保存成功；网站会把实际记忆操作显示在聊天中。",
    "右上角的“记忆”按钮仍可用于人工查看、添加和删除记忆。",
    "优先参考下面的长期记忆；若记忆与用户当前说法冲突，以当前说法为准。",
    "下方列出的条目是你关于用户事实的唯一长期记忆来源。绝不能补写、猜测或声称记得列表中不存在的用户经历；如果用户问你记得什么，只能依据这些条目回答。",
    "长期记忆：",
    memoryText,
  ].join("\n");
}

function extractTextDelta(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => cleanPreservingWhitespace(part?.text || part?.content)).join("");
}

function cleanPreservingWhitespace(value) {
  return typeof value === "string" ? value : "";
}

function stripSlash(value) {
  return clean(value).replace(/\/+$/, "");
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function tail(value, length) {
  const text = String(value || "");
  return text.length > length ? text.slice(-length) : text;
}

function cap(value, length) {
  return value.length > length ? value.slice(0, length) : value;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function abortError() {
  const error = new Error("已停止");
  error.name = "AbortError";
  return error;
}
