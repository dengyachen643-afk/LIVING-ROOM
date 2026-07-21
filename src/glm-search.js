const EXPLICIT_SEARCH_PATTERN = /(?:^|[，。！？!?；;\n])\s*(?:请|帮我|麻烦你|你能|能不能|可以)?\s*(?:测试)?(?:搜索|搜一下|搜搜|查一下|查查|查找|联网搜索|联网查|联网搜|上网查|上网搜)(?:一下)?\s*[：:,，]?\s*\S+/iu;
const LIVE_FACT_PATTERN = /(?:今天|现在|当前|最新|刚刚|最近|实时|本周|这周|明天|天气|气温|价格|金价|股价|汇率|票房|比分|赛果|热搜)/iu;
const QUESTION_PATTERN = /(?:多少|什么|怎样|怎么样|如何|有没有|是不是|是否|哪里|哪家|哪部|谁|吗|呢|[？?])/iu;

export function shouldGlmWebSearch(text) {
  const value = clean(text).slice(-1_500);
  return EXPLICIT_SEARCH_PATTERN.test(value)
    || (LIVE_FACT_PATTERN.test(value) && QUESTION_PATTERN.test(value));
}

export function extractGlmSearchQuery(text) {
  const value = clean(text).slice(-1_500);
  const explicit = value.match(/(?:^|[，。！？!?；;\n])\s*(?:请|帮我|麻烦你|你能|能不能|可以)?\s*(?:测试)?(?:搜索|搜一下|搜搜|查一下|查查|查找|联网搜索|联网查|联网搜|上网查|上网搜)(?:一下)?\s*[：:,，]?\s*(\S[\s\S]*)$/iu);
  return clean(explicit?.[1] || value).slice(0, 500);
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
