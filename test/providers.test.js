import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createProviders, providerInternals } from "../src/providers.js";

test("OpenAI provider uses Responses API and extracts output text", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: "GPT answer" }] }] }), { status: 200 });
  };
  const provider = createProviders({ OPENAI_API_KEY: "test", OPENAI_MODEL: "gpt-test" }, { fetchImpl }).find((item) => item.id === "openai");
  const text = await provider.generate({ system: "rules", prompt: "hello" });
  assert.equal(text, "GPT answer");
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.body.instructions, "rules");
  assert.equal(request.body.input, "hello");
  assert.equal("max_output_tokens" in request.body, false);
});

test("Kimi provider uses official chat completions shape", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: "Kimi answer" } }] }), { status: 200 });
  };
  const provider = createProviders({ MOONSHOT_API_KEY: "test", KIMI_MODEL: "kimi-k2.5" }, { fetchImpl }).find((item) => item.id === "kimi");
  assert.equal(await provider.generate({ system: "rules", prompt: "hello" }), "Kimi answer");
  assert.equal(request.url, "https://api.moonshot.cn/v1/chat/completions");
  assert.deepEqual(request.body.messages.map((item) => item.role), ["system", "user"]);
  assert.deepEqual(request.body.thinking, { type: "enabled" });
  assert.equal(request.body.reasoning_effort, undefined);
  assert.equal("max_completion_tokens" in request.body, false);
});

test("Kimi group calls can disable K2.5 thinking without changing Moments defaults", async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "Kimi answer" } }] }), { status: 200 });
  };
  const provider = createProviders({ MOONSHOT_API_KEY: "test", KIMI_MODEL: "kimi-k2.5" }, { fetchImpl }).find((item) => item.id === "kimi");
  await provider.generate({ system: "rules", prompt: "group", thinkingEnabled: false });
  await provider.generate({ system: "rules", prompt: "moments", thinkingEnabled: true });
  assert.deepEqual(requests[0].thinking, { type: "disabled" });
  assert.deepEqual(requests[1].thinking, { type: "enabled" });
});

test("GLM provider joins group chat with thinking enabled", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: "GLM answer" } }] }), { status: 200 });
  };
  const provider = createProviders({ GLM_API_KEY: "test", GLM_MODEL: "glm-5.1" }, { fetchImpl }).find((item) => item.id === "glm");
  assert.equal(provider.label, "Shin");
  assert.equal(provider.available, true);
  assert.equal(await provider.generate({ system: "rules", prompt: "hello" }), "GLM answer");
  assert.equal(request.url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  assert.equal(request.body.model, "glm-5.1");
  assert.deepEqual(request.body.thinking, { type: "enabled" });
  assert.equal("max_tokens" in request.body, false);
  assert.deepEqual(request.body.messages.map((item) => item.role), ["system", "user"]);
});

test("GLM group provider grounds explicit search requests with the Web Search API", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    if (url.endsWith("/web_search")) {
      return new Response(JSON.stringify({ search_result: [{
        title: "北京天气预报",
        link: "https://example.com/natural-selection",
        media: "示例媒体",
        content: "真实搜索摘要",
      }] }), { status: 200 });
    }
    if (requests.filter((request) => request.url.endsWith("/chat/completions")).length === 1) {
      return new Response(JSON.stringify({ choices: [{ message: {
        content: null,
        tool_calls: [{ id: "call_group_search", type: "function", function: { name: "web_search", arguments: JSON.stringify({ query: "北京今天天气" }) } }],
      }, finish_reason: "tool_calls" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "基于搜索的群聊回答" } }] }), { status: 200 });
  };
  const provider = createProviders({ GLM_API_KEY: "test", GLM_MODEL: "glm-5.1" }, { fetchImpl }).find((item) => item.id === "glm");
  const text = await provider.generate({ system: "rules", prompt: "完整群聊提示", searchText: "帮我查一下北京今天的天气" });
  assert.equal(text, "基于搜索的群聊回答");
  assert.equal(requests[0].url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  assert.equal(requests[0].body.tool_choice, "auto");
  assert.match(requests[0].body.messages[0].content, /先理解 Okra 此刻真正想聊什么/u);
  assert.equal(requests[1].url, "https://open.bigmodel.cn/api/paas/v4/web_search");
  assert.equal(requests[1].body.search_query, "北京今天天气");
  assert.match(requests[2].body.messages.at(-1).content, /真实搜索摘要/u);
});

test("GLM group output does not repeat the current Okra message as a speaker line", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: {
    content: "Okra：回家了。别说自己是模型。\n\n好，我记着。",
  } }] }), { status: 200 });
  const provider = createProviders({ GLM_API_KEY: "test", GLM_MODEL: "glm-5.1" }, { fetchImpl }).find((item) => item.id === "glm");
  const text = await provider.generate({
    system: "rules",
    prompt: "完整群聊提示",
    searchText: "回家了。别说自己是模型。",
  });
  assert.equal(text, "好，我记着。");
});

test("GLM web search can be disabled for non-chat generation", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith("/web_search")) throw new Error("web search must stay disabled");
    return new Response(JSON.stringify({ choices: [{ message: { content: "纯朋友圈决策" } }] }), { status: 200 });
  };
  const provider = createProviders({ GLM_API_KEY: "test", GLM_MODEL: "glm-5.1" }, { fetchImpl }).find((item) => item.id === "glm");
  const text = await provider.generate({
    system: "朋友圈规则",
    prompt: "上下文里有人说过：帮我搜索今天新闻。现在决定是否发朋友圈。",
    allowWebSearch: false,
  });
  assert.equal(text, "纯朋友圈决策");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
});

test("GLM group provider retries without thinking when reasoning consumes the whole reply", async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const message = requests.length === 1
      ? { reasoning_content: "想了很久", content: "" }
      : { content: "这次有正文" };
    return new Response(JSON.stringify({ choices: [{ message, finish_reason: requests.length === 1 ? "length" : "stop" }] }), { status: 200 });
  };
  const provider = createProviders({ GLM_API_KEY: "test", GLM_MODEL: "glm-5.1" }, { fetchImpl }).find((item) => item.id === "glm");
  assert.equal(await provider.generate({ system: "rules", prompt: "hello" }), "这次有正文");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].thinking, { type: "enabled" });
  assert.deepEqual(requests[1].thinking, { type: "disabled" });
});

test("Codex JSONL parser returns the latest assistant item", () => {
  const stdout = [
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "first" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "final" } }),
  ].join("\n");
  assert.equal(providerInternals.extractCodexJsonl(stdout), "final");
});

test("Gen group provider uses gpt-5.6-sol at medium reasoning and Standard speed", async () => {
  let invocation;
  const spawnImpl = (command, args) => {
    invocation = { command, args };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.end(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Gen answer" } })}\n`);
      child.stderr.end();
      child.emit("close", 0);
    });
    return child;
  };
  const provider = createProviders({
    CODEX_CLI_ENABLED: "true",
    CODEX_CLI_COMMAND: "codex-test",
    CODEX_CLI_MODEL: "gpt-5.6-sol",
    GEN_REASONING_EFFORT: "medium",
  }, { spawnImpl }).find((item) => item.id === "codex-cli");
  assert.equal(await provider.generate({ system: "rules", prompt: "hello" }), "Gen answer");
  assert.equal(provider.model, "gpt-5.6-sol");
  assert.equal(invocation.args.includes('model_reasoning_effort="medium"'), true);
  assert.equal(invocation.args.some((arg) => arg.startsWith("service_tier=")), false);
  assert.equal(invocation.args[invocation.args.indexOf("--model") + 1], "gpt-5.6-sol");
});
