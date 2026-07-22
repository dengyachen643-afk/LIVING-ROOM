export const GLM_WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "搜索互联网以核实实时、近期或当前对话中缺失的外部事实。不要用于闲聊、个人经历、关系讨论、情绪陪伴、创作，也不要仅因用户提到‘最近、今天、搜索’等词就调用。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "只包含需要查询的外部事实，改写成简洁明确的搜索词，不要原样复制整段对话。" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

export const GLM_SEARCH_TOOL_SYSTEM_PROMPT = [
  "# 联网工具",
  "你可以自行决定是否调用 web_search。先理解 Okra 此刻真正想聊什么，再决定是否需要外部资料。",
  "只有回答确实依赖实时新闻、当前价格、天气、赛果、近期公开事件或你不确定且需要核实的外部事实时才搜索。",
  "闲聊、个人经历、关系与情绪话题、对既有聊天内容的追问，以及仅仅出现‘最近、今天、搜索’等词时，直接根据上下文回答，不要搜索。",
  "决定搜索时，把 query 改写成独立、简洁的检索词；禁止把用户整段消息原样当作 query。",
].join("\n");

export function getGlmWebSearchToolCall(message) {
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const call = calls.find((item) => item?.function?.name === "web_search");
  if (!call) return null;
  let args = {};
  try { args = JSON.parse(call.function?.arguments || "{}"); } catch { return null; }
  const query = clean(args?.query).slice(0, 500);
  return query ? { id: clean(call.id), query, raw: call } : null;
}

export function extractGlmSearchQuery(text) {
  return clean(text).slice(0, 500);
}

export async function runGlmWebSearch({
  fetchImpl = globalThis.fetch,
  apiKey,
  baseUrl = "https://open.bigmodel.cn/api/paas/v4",
  query,
  signal,
  count = 5,
} = {}) {
  const searchQuery = extractGlmSearchQuery(query);
  if (!searchQuery) throw new Error("没有可搜索的关键词");
  const response = await fetchImpl(`${stripSlash(baseUrl)}/web_search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${clean(apiKey)}` },
    body: JSON.stringify({
      search_query: searchQuery,
      search_engine: "search_std",
      search_intent: true,
      count: Math.max(1, Math.min(10, Number(count) || 5)),
      search_recency_filter: "noLimit",
      content_size: "medium",
    }),
    signal,
  });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { /* handled below */ }
  if (!response.ok) {
    const detail = clean(payload?.error?.message || payload?.message || raw);
    throw new Error(`联网搜索失败 (${response.status})：${detail.slice(-500) || "接口没有返回结果"}`);
  }
  const results = (Array.isArray(payload?.search_result) ? payload.search_result : [])
    .map((item) => ({
      title: clean(item?.title),
      link: clean(item?.link),
      media: clean(item?.media),
      publishDate: clean(item?.publish_date),
      content: clean(item?.content).slice(0, 2_000),
    }))
    .filter((item) => item.title || item.content || item.link)
    .slice(0, 10);
  if (!results.length) throw new Error(`没有搜到“${searchQuery}”的有效网页结果`);
  return { query: searchQuery, results };
}

export function formatGlmSearchContext(search) {
  const lines = search.results.map((item, index) => [
    `[${index + 1}] ${item.title || item.media || "网页结果"}`,
    item.media ? `来源：${item.media}` : "",
    item.publishDate ? `发布日期：${item.publishDate}` : "",
    item.link ? `链接：${item.link}` : "",
    item.content,
  ].filter(Boolean).join("\n"));
  return [
    `以下是刚刚对“${search.query}”执行真实联网搜索得到的网页结果：`,
    ...lines,
    "请基于这些结果自然回答；区分网页事实与自己的判断。需要引用时直接给出来源名称或链接，不要声称搜索了结果中不存在的内容。",
  ].join("\n\n");
}

function stripSlash(value) {
  return clean(value).replace(/\/+$/u, "");
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
