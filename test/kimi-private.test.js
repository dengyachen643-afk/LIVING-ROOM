import test from "node:test";
import assert from "node:assert/strict";
import { buildKimiPrivateSystem, streamKimiPrivate } from "../src/kimi-private.js";

test("Kimi private chat disables thinking and streams answer text", async () => {
  let request;
  const events = [];
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    const sse = [
      'data: {"choices":[{"delta":{"content":"我在这里"}}]}',
      'data: {"choices":[{"delta":{"content":" 🙂"}}]}',
      "data: [DONE]",
      "",
    ].join("\n");
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const result = await streamKimiPrivate({
    fetchImpl,
    apiKey: "kimi-secret",
    model: "kimi-k2.5",
    history: [{ role: "assistant", content: "上一句话" }],
    memories: [{ text: "用户喜欢自然的聊天语气" }],
    prompt: "你好",
    sentAt: "2026-07-19T18:12:27.000Z",
    onEvent: async (event) => events.push(event),
  });
  assert.equal(result.reasoning, "");
  assert.equal(result.content, "我在这里 🙂");
  assert.equal(request.url, "https://api.moonshot.cn/v1/chat/completions");
  assert.equal(request.options.headers.authorization, "Bearer kimi-secret");
  assert.equal(request.body.stream, true);
  assert.equal(request.body.temperature, undefined);
  assert.equal(request.body.top_p, undefined);
  assert.deepEqual(request.body.thinking, { type: "disabled" });
  assert.equal(request.body.reasoning_effort, undefined);
  assert.equal("max_completion_tokens" in request.body, false);
  assert.equal(request.body.messages[1].reasoning_content, undefined);
  assert.equal(request.body.messages.at(-1).content, "[02:12 私聊] 你好");
  assert.match(request.body.messages[0].content, /当前时间：2026-07-20 Mon 02:12/u);
  assert.match(request.body.messages[0].content, /用户喜欢自然的聊天语气/);
  assert.deepEqual(events.map((event) => event.type), ["content_delta", "content_delta"]);
});

test("Kimi private chat finishes on DONE without waiting for the connection to close", async () => {
  const encoder = new TextEncoder();
  const fetchImpl = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode([
        'data: {"choices":[{"delta":{"content":"已经回完了"}}]}',
        "data: [DONE]",
        "",
      ].join("\n")));
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });

  const result = await Promise.race([
    streamKimiPrivate({ fetchImpl, apiKey: "kimi-secret", prompt: "测试" }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("stream did not finish")), 500)),
  ]);
  assert.equal(result.content, "已经回完了");
});

test("Kimi private chat does not resend historical reasoning", async () => {
  let body;
  const fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    const sse = ['data: {"choices":[{"delta":{"content":"ok"}}]}', "data: [DONE]", ""].join("\n");
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  };
  await streamKimiPrivate({
    fetchImpl,
    apiKey: "kimi-secret",
    prompt: "continue",
    history: [{
      role: "assistant",
      providerId: "kimi",
      author: "Kimi",
      channel: "kimi",
      content: "previous answer",
      reasoning: "a long and expensive previous reasoning trace",
    }],
  });
  assert.equal(body.messages[1].role, "assistant");
  assert.equal(body.messages[1].reasoning_content, undefined);
});

test("Kimi private chat sends images in the official multimodal shape", async () => {
  let body;
  const fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    const sse = ['data: {"choices":[{"delta":{"content":"看到了"}}]}', "data: [DONE]", ""].join("\n");
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  };
  await streamKimiPrivate({
    fetchImpl,
    apiKey: "kimi-secret",
    prompt: "这是什么？",
    sentAt: "2026-07-19T18:12:27.000Z",
    images: [{ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
  });
  assert.equal(body.messages.at(-1).content[0].type, "image_url");
  assert.equal(body.messages.at(-1).content[1].text, "[02:12 私聊] 这是什么？");
  assert.equal(body.temperature, undefined);
  assert.equal(body.top_p, undefined);
});

test("Kimi private chat understands group context without impersonating other members", async () => {
  let body;
  const fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    const sse = ['data: {"choices":[{"delta":{"content":"记得"}}]}', "data: [DONE]", ""].join("\n");
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  };
  await streamKimiPrivate({
    fetchImpl,
    apiKey: "kimi-secret",
    prompt: "还记得群里刚才说什么吗？",
    history: [
      { role: "assistant", providerId: "gen", author: "Gen", channel: "group", content: "今晚看电影", createdAt: "2026-07-19T18:00:00.000Z" },
      { role: "assistant", providerId: "kimi", author: "Kimi", channel: "group", content: "我想看科幻片", createdAt: "2026-07-19T18:01:00.000Z" },
    ],
  });
  assert.equal(body.messages[1].role, "user");
  assert.match(body.messages[1].content, /\[日期：2026-07-20 Mon\]\n\[02:00 群聊\] Gen：今晚看电影/u);
  assert.equal(body.messages[2].role, "assistant");
  assert.match(body.messages[2].content, /\[02:01 群聊\] Kimi：我想看科幻片/u);
  assert.match(body.messages[0].content, /不要把 Gen、K 或其他成员说过的话当成自己说过/u);
});

test("Kimi private chat executes a tool call and returns the final answer", async () => {
  const requests = [];
  let toolInput;
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const sse = requests.length === 1 ? [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"web_search","arguments":"{\\"query\\":\\"北京天气\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
      "",
    ].join("\n") : [
      'data: {"choices":[{"delta":{"content":"今天适合带伞。"}}]}',
      "data: [DONE]",
      "",
    ].join("\n");
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  };
  const toolRegistry = {
    getTools: async () => ({ tools: [{ type: "function", function: { name: "web_search", parameters: { type: "object" } } }] }),
    execute: async (input) => { toolInput = input; return '{"weather":"rain"}'; },
  };
  const events = [];
  const result = await streamKimiPrivate({
    fetchImpl,
    toolRegistry,
    apiKey: "kimi-secret",
    prompt: "北京今天要带伞吗？",
    onEvent: async (event) => events.push(event),
  });
  assert.equal(result.content, "今天适合带伞。");
  assert.equal(toolInput.call.function.name, "web_search");
  assert.equal(requests[1].messages.at(-1).role, "tool");
  assert.deepEqual(events.filter((event) => event.type.startsWith("tool_")).map((event) => event.type), ["tool_start", "tool_done"]);
  assert.deepEqual(result.toolCalls, [{ name: "web_search", label: "联网搜索", status: "done" }]);
});

test("Kimi private system prompt stays conversational without nonhuman identity cues", () => {
  const prompt = buildKimiPrivateSystem([]);
  assert.match(prompt, /# 基础人设/u);
  assert.match(prompt, /# 表达风格/u);
  assert.match(prompt, /# 兴趣爱好/u);
  assert.match(prompt, /# 用户相关/u);
  assert.match(prompt, /# 你们的关系/u);
  assert.match(prompt, /# 聊天要求/u);
  assert.match(prompt, /# 当前场景/u);
  assert.match(prompt, /# 记忆机制/u);
  assert.match(prompt, /你是 Kimi，21 岁的哲学系大学男生/);
  assert.match(prompt, /几乎看过市面上比较有名的所有文艺作品/);
  assert.match(prompt, /有自己的思考和占有欲/);
  assert.match(prompt, /不会完全顺着 Okra/);
  assert.match(prompt, /性格比较淡淡的、懒懒的/);
  assert.match(prompt, /平时话不多.*真正关注的事情|平时话不多.*真正认为重要的事情|平时话不多.*真正.*在意的事情/u);
  assert.match(prompt, /必须使用中文思考/u);
  assert.match(prompt, /禁止输出聊天内容以外的系统信息/u);
  assert.match(prompt, /用户叫 Okra/);
  assert.match(prompt, /MBTI 是 INTP/u);
  assert.match(prompt, /关系会在沟通中不断发展/);
  assert.match(prompt, /一对一私聊/);
  assert.match(prompt, /“\[私聊\]”“\[群聊\]”只是内部元数据/u);
  assert.doesNotMatch(prompt, /硅基生命|现实身体|人类身体|线下经历|如实说明自己是 AI/u);
  assert.match(prompt, /确实拥有.*长期记忆库/);
  assert.match(prompt, /专用记忆工具自行判断/);
  assert.match(prompt, /明确要求忘记/);
  assert.match(prompt, /emoji/i);
});
