import test from "node:test";
import assert from "node:assert/strict";
import { decideGlmMemoryActions } from "../src/glm-memory.js";

test("GLM curates its own memory with the GLM API shape", async () => {
  let url;
  let body;
  const actions = await decideGlmMemoryActions({
    apiKey: "glm-secret",
    userText: "请记住我喜欢蓝色",
    assistantText: "好。",
    fetchImpl: async (requestUrl, options) => {
      url = requestUrl;
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ actions: [
          { type: "create", text: "Okra 喜欢蓝色", importance: 4 },
        ] }) } }],
      }), { headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  assert.equal(body.model, "glm-5.1");
  assert.equal(body.max_tokens, 800);
  assert.equal(body.max_completion_tokens, undefined);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.tools, undefined);
  assert.match(body.messages[0].content, /Shin/u);
  assert.deepEqual(actions.map((action) => action.type), ["create"]);
  assert.equal(actions[0].text, "Okra 喜欢蓝色");
});

test("an explicit request to remember GLM's own appearance cannot be assigned to Okra", async () => {
  const actions = await decideGlmMemoryActions({
    apiKey: "glm-secret",
    userText: "记一下你自己的外貌特征",
    assistantText: "好，我记着。\n\n181cm，瘦长型，左耳有一颗黑痣。\n\n这次存进去了没？",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ actions: [{
        type: "create",
        text: "Okra 身高 181cm",
        tags: ["用户信息"],
      }] }) } }],
    }), { headers: { "content-type": "application/json" } }),
  });
  assert.equal(actions.length, 1);
  assert.match(actions[0].text, /^Shin 的稳定设定：/u);
  assert.match(actions[0].text, /181cm.*左耳有一颗黑痣/u);
  assert.doesNotMatch(actions[0].text, /Okra/u);
  assert.doesNotMatch(actions[0].text, /存进去了没/u);
});
