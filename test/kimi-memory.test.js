import test from "node:test";
import assert from "node:assert/strict";
import { decideKimiMemoryActions } from "../src/kimi-memory.js";

function toolResponse(toolCalls) {
  return new Response(JSON.stringify({ choices: [{ message: { tool_calls: toolCalls } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("Kimi memory curator parses create and valid update actions", async () => {
  let body;
  const actions = await decideKimiMemoryActions({
    apiKey: "secret",
    userText: "请记住我喜欢爵士乐",
    assistantText: "好，我会记住。",
    memories: [{ id: "known", text: "用户喜欢电影" }],
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return toolResponse([
        { function: { name: "create_memory", arguments: JSON.stringify({ text: "用户喜欢爵士乐", tags: ["音乐"], importance: 4 }) } },
        { function: { name: "update_memory", arguments: JSON.stringify({ id: "known", text: "用户喜欢电影和文艺片" }) } },
        { function: { name: "update_memory", arguments: JSON.stringify({ id: "unknown", text: "不应执行" }) } },
      ]);
    },
  });
  assert.equal(body.stream, false);
  assert.equal(body.model, "kimi-k3");
  assert.equal(body.temperature, undefined);
  assert.equal(body.top_p, undefined);
  assert.equal(body.max_completion_tokens, 600);
  assert.deepEqual(actions.map((action) => action.type), ["create", "update"]);
  assert.equal(actions[0].text, "用户喜欢爵士乐");
});

test("Kimi memory curator rejects deletion unless the user explicitly asks", async () => {
  const run = (userText) => decideKimiMemoryActions({
    apiKey: "secret",
    userText,
    assistantText: "知道了。",
    memories: [{ id: "m1", text: "用户喜欢爵士乐" }],
    fetchImpl: async () => toolResponse([
      { function: { name: "delete_memory", arguments: JSON.stringify({ id: "m1" }) } },
    ]),
  });
  assert.deepEqual(await run("我们聊点别的"), []);
  assert.equal((await run("请忘掉我喜欢爵士乐这件事"))[0].type, "delete");
});

test("automatic memory rejects profile dumps and temporary technical chores", async () => {
  const longProfile = `Okra 的基本信息：${"身份、工作、关系和偏好；".repeat(20)}`;
  const actions = await decideKimiMemoryActions({
    apiKey: "secret",
    userText: "今天先给 Kimi 修去重，其他服务器功能明天再说",
    assistantText: "好。",
    fetchImpl: async () => toolResponse([
      { function: { name: "create_memory", arguments: JSON.stringify({ text: longProfile }) } },
      { function: { name: "create_memory", arguments: JSON.stringify({ text: "Okra 今天计划修复 Kimi 去重，暂时不处理服务器新功能" }) } },
      { function: { name: "create_memory", arguments: JSON.stringify({ text: "Okra 长期喜欢爵士乐" }) } },
    ]),
  });
  assert.deepEqual(actions, []);
});

test("explicit memory intent can preserve a temporary fact but still rejects oversized dumps", async () => {
  const actions = await decideKimiMemoryActions({
    apiKey: "secret",
    userText: "请记住我今天要处理服务器迁移",
    assistantText: "好。",
    fetchImpl: async () => toolResponse([
      { function: { name: "create_memory", arguments: JSON.stringify({ text: "Okra 今天要处理服务器迁移" }) } },
      { function: { name: "create_memory", arguments: JSON.stringify({ text: "档案：".repeat(200) }) } },
    ]),
  });
  assert.deepEqual(actions.map((action) => action.text), ["Okra 今天要处理服务器迁移"]);
});
