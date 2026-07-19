import test from "node:test";
import assert from "node:assert/strict";
import { buildKimiPrivateSystem, streamKimiPrivate } from "../src/kimi-private.js";

test("Kimi private chat streams reasoning and answer text", async () => {
  let request;
  const events = [];
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"先理解用户。"}}]}',
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
    model: "kimi-test",
    history: [{ role: "assistant", content: "上一句话" }],
    memories: [{ text: "用户喜欢自然的聊天语气" }],
    prompt: "你好",
    sentAt: "2026-07-19T18:12:27.000Z",
    onEvent: async (event) => events.push(event),
  });
  assert.equal(result.reasoning, "先理解用户。");
  assert.equal(result.content, "我在这里 🙂");
  assert.equal(request.url, "https://api.moonshot.cn/v1/chat/completions");
  assert.equal(request.options.headers.authorization, "Bearer kimi-secret");
  assert.equal(request.body.stream, true);
  assert.equal(request.body.temperature, undefined);
  assert.equal(request.body.top_p, undefined);
  assert.equal(request.body.max_completion_tokens, 2400);
  assert.equal(request.body.messages.at(-1).content, "[发送时间：2026-07-20 02:12:27（Asia/Shanghai，UTC+08:00）]\n你好");
  assert.match(request.body.messages[0].content, /当前时间：2026-07-20 02:12:27/u);
  assert.match(request.body.messages[0].content, /用户喜欢自然的聊天语气/);
  assert.deepEqual(events.map((event) => event.type), ["thinking_delta", "content_delta", "content_delta"]);
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
  assert.equal(body.messages.at(-1).content[1].text, "[发送时间：2026-07-20 02:12:27（Asia/Shanghai，UTC+08:00）]\n这是什么？");
  assert.equal(body.temperature, undefined);
  assert.equal(body.top_p, undefined);
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

test("Kimi private system prompt is conversational without pretending to be human", () => {
  const prompt = buildKimiPrivateSystem([]);
  assert.match(prompt, /你是 Kimi，由 Moonshot AI 提供的人工智能助手/);
  assert.match(prompt, /用户叫 okra/);
  assert.match(prompt, /INTP 硅基生命/);
  assert.match(prompt, /关系会在沟通中不断发展/);
  assert.match(prompt, /一对一私聊/);
  assert.match(prompt, /不要假装拥有现实身体/);
  assert.match(prompt, /确实拥有.*长期记忆库/);
  assert.match(prompt, /专用记忆工具自行判断/);
  assert.match(prompt, /明确要求忘记/);
  assert.match(prompt, /唯一长期记忆来源/);
  assert.match(prompt, /emoji/i);
});
