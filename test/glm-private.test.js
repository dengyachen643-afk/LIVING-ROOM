import test from "node:test";
import assert from "node:assert/strict";
import { streamGlmPrivate } from "../src/glm-private.js";
import { extractGlmSearchQuery, shouldGlmWebSearch } from "../src/glm-search.js";

test("mentioning the search feature does not trigger GLM web search", () => {
  assert.equal(shouldGlmWebSearch("我觉得 nice 的是你终于可以调用搜索了"), false);
  assert.equal(shouldGlmWebSearch("Shin，帮我查一下深圳今天的天气"), true);
  assert.equal(extractGlmSearchQuery("Shin，帮我查一下深圳今天的天气"), "深圳今天的天气");
  assert.equal(shouldGlmWebSearch("深圳今天会下雨吗？"), true);
});

test("GLM private chat streams reasoning and answer text", async () => {
  let request;
  const events = [];
  const fetchImpl = async (url, options) => {
    request = { url, body: JSON.parse(options.body), headers: options.headers };
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"先想一下。"}}]}',
      'data: {"choices":[{"delta":{"content":"你好，Okra"}}]}',
      "data: [DONE]",
      "",
    ].join("\n");
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  };
  const result = await streamGlmPrivate({
    fetchImpl,
    apiKey: "glm-secret",
    prompt: "你好",
    memories: [{ text: "Okra 喜欢电影" }],
    sentAt: "2026-07-20T02:00:00.000Z",
    onEvent: async (event) => events.push(event),
  });
  assert.equal(request.url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  assert.equal(request.body.model, "glm-5.1");
  assert.deepEqual(request.body.thinking, { type: "enabled" });
  assert.equal(request.body.stream, true);
  assert.equal(result.reasoning, "先想一下。");
  assert.equal(result.content, "你好，Okra");
  assert.match(request.body.messages[0].content, /Okra 喜欢电影/u);
  assert.match(request.body.messages[0].content, /27 岁的男性，MBTI 是 ENTP/u);
  assert.doesNotMatch(request.body.messages[0].content, /硅基生命|现实身体|真实线下生活|如实说明自己是.*AI/u);
  assert.match(request.body.messages[0].content, /中型广告公司担任策略策划/u);
  assert.match(request.body.messages[0].content, /必须使用中文思考/u);
  assert.match(request.body.messages[0].content, /不要为了延伸对话.*二选一提问/u);
  assert.match(request.body.messages[0].content, /禁止提及网站、后台、系统、数据库、记忆库操作、写入或保存是否成功/u);
  assert.deepEqual(events.map((event) => event.type), ["thinking_delta", "content_delta"]);
});

test("GLM private chat performs a real web search before answering", async () => {
  const events = [];
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith("/web_search")) {
      return new Response(JSON.stringify({ search_result: [{
        title: "北京天气预报",
        link: "https://example.com/exhibition",
        media: "示例媒体",
        publish_date: "2026-07-20",
        content: "展览信息",
      }] }), { headers: { "content-type": "application/json" } });
    }
    const sse = [
      'data: {"choices":[{"delta":{"content":"搜索后的回答"}}]}',
      "data: [DONE]",
      "",
    ].join("\n");
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  };
  const result = await streamGlmPrivate({
    fetchImpl,
    apiKey: "glm-secret",
    prompt: "帮我查一下北京今天的天气",
    onEvent: async (event) => events.push(event),
  });
  assert.equal(result.content, "搜索后的回答");
  assert.equal(requests[0].url, "https://open.bigmodel.cn/api/paas/v4/web_search");
  assert.equal(requests[0].body.search_query, "北京今天的天气");
  assert.match(requests[1].body.messages.at(-1).content, /北京天气预报/u);
  assert.deepEqual(result.toolCalls, [{ name: "web_search", label: "联网搜索", status: "done" }]);
  assert.deepEqual(events.map((event) => event.type), ["tool_start", "tool_done", "content_delta"]);
});

test("GLM image messages use the vision model", async () => {
  let body;
  const fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    const sse = ['data: {"choices":[{"delta":{"content":"看到了"}}]}', "data: [DONE]", ""].join("\n");
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  };
  const result = await streamGlmPrivate({
    fetchImpl,
    apiKey: "glm-secret",
    prompt: "这是什么",
    images: [{ dataUrl: "data:image/png;base64,AAAA" }],
  });
  assert.equal(body.model, "glm-5v-turbo");
  assert.equal(body.messages.at(-1).content[0].type, "image_url");
  assert.equal(result.model, "glm-5v-turbo");
});

test("GLM private chat receives room context with every speaker correctly attributed", async () => {
  let body;
  const fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    const sse = ['data: {"choices":[{"delta":{"content":"接上了"}}]}', "data: [DONE]", ""].join("\n");
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  };
  await streamGlmPrivate({
    fetchImpl,
    apiKey: "glm-secret",
    prompt: "继续",
    history: [
      { role: "assistant", providerId: "gen", author: "Gen", channel: "group", content: "Gen 在群里说的话", createdAt: "2026-07-20T01:00:00.000Z" },
      { role: "assistant", providerId: "glm", author: "GLM", channel: "group", content: "GLM 在群里的回答", createdAt: "2026-07-20T01:01:00.000Z" },
      { role: "user", author: "Okra", channel: "glm", content: "私聊上一句", createdAt: "2026-07-20T01:02:00.000Z" },
    ],
  });
  assert.equal(body.messages[1].role, "user");
  assert.match(body.messages[1].content, /\[日期：2026-07-20 Mon\]\n\[09:00 群聊\] Gen：Gen 在群里说的话/u);
  assert.equal(body.messages[2].role, "assistant");
  assert.match(body.messages[2].content, /\[09:01 群聊\] Shin：GLM 在群里的回答/u);
  assert.match(body.messages[3].content, /\[09:02 私聊\] Okra：私聊上一句/u);
});
