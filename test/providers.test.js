import test from "node:test";
import assert from "node:assert/strict";
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
});

test("Kimi provider uses official chat completions shape", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: "Kimi answer" } }] }), { status: 200 });
  };
  const provider = createProviders({ MOONSHOT_API_KEY: "test", KIMI_MODEL: "kimi-test" }, { fetchImpl }).find((item) => item.id === "kimi");
  assert.equal(await provider.generate({ system: "rules", prompt: "hello" }), "Kimi answer");
  assert.equal(request.url, "https://api.moonshot.cn/v1/chat/completions");
  assert.deepEqual(request.body.messages.map((item) => item.role), ["system", "user"]);
});

test("Codex JSONL parser returns the latest assistant item", () => {
  const stdout = [
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "first" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "final" } }),
  ].join("\n");
  assert.equal(providerInternals.extractCodexJsonl(stdout), "final");
});
