import test from "node:test";
import assert from "node:assert/strict";
import { extractMentions, HARD_MAX_CHAIN_MESSAGES, runGroupChat } from "../src/groupchat.js";

function fakeProvider(id, label, reply = `${label} 回复`) {
  return {
    id,
    label,
    kind: "test",
    model: `${id}-model`,
    available: true,
    async generate() { return typeof reply === "function" ? reply() : reply; },
  };
}

const userMessage = (content) => ({ id: "u1", role: "user", author: "用户", content });

test("group prompts include authoritative message timestamps", async () => {
  let request;
  const provider = {
    ...fakeProvider("kimi", "Kimi"),
    async generate(input) { request = input; return "收到"; },
  };
  await runGroupChat({
    providers: [provider],
    participantIds: ["kimi"],
    history: [{ ...userMessage("刚才发生了什么？"), createdAt: "2026-07-19T18:12:27.000Z" }],
  });
  assert.match(request.system, /当前时间：2026-07-20 02:12:27/u);
  assert.match(request.prompt, /\[2026-07-20 02:12:27（Asia\/Shanghai，UTC\+08:00）\] 你：刚才发生了什么/u);
});

test("a user @ mention routes only to the named AI", async () => {
  const called = [];
  const providers = ["GPT", "Kimi"].map((label, index) => ({
    ...fakeProvider(index ? "kimi" : "openai", label),
    async generate() { called.push(label); return `${label} 在群里回复`; },
  }));
  const result = await runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("@Kimi 你怎么看？")],
  });
  assert.deepEqual(called, ["Kimi"]);
  assert.equal(result.reason, "idle");
});

test("a normal group message invites all selected AI members", async () => {
  const messages = [];
  const providers = [fakeProvider("openai", "GPT"), fakeProvider("kimi", "Kimi")];
  await runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("大家聊聊这个方案")],
    onEvent: (event) => { if (event.type === "message") messages.push(event.message.providerId); },
  });
  assert.deepEqual(messages, ["openai", "kimi"]);
});

test("an AI can @ another AI and hand off the conversation", async () => {
  const messages = [];
  const providers = [
    fakeProvider("openai", "GPT", "我先给一个观点。@Kimi 你怎么看？"),
    fakeProvider("kimi", "Kimi", "我补充另一种看法。"),
  ];
  await runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("@GPT 先说说")],
    onEvent: (event) => { if (event.type === "message") messages.push(event.message); },
  });
  assert.deepEqual(messages.map((message) => message.providerId), ["openai", "kimi"]);
  assert.equal(messages[1].triggeredBy, "GPT");
  assert.equal(messages[1].replyToId, messages[0].id);
});

test("repeated AI-to-AI mention edges cannot create an infinite loop", async () => {
  const providers = [
    fakeProvider("openai", "GPT", "@Kimi 接一下"),
    fakeProvider("kimi", "Kimi", "@GPT 再补充"),
  ];
  const result = await runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("@GPT 开始")],
    maxMessages: 999,
    perAgentMax: 999,
    relayDepth: 999,
  });
  assert.equal(result.completedMessages, 3);
  assert.equal(result.reason, "idle");
  assert.equal(result.maxMessages, HARD_MAX_CHAIN_MESSAGES);
});

test("the hard chain budget stops a still-pending handoff", async () => {
  const providers = [
    fakeProvider("openai", "GPT", "@Kimi 接一下"),
    fakeProvider("kimi", "Kimi", "@Claude 接一下"),
    fakeProvider("anthropic", "Claude", "收到"),
  ];
  const result = await runGroupChat({
    providers,
    participantIds: ["openai", "kimi", "anthropic"],
    history: [userMessage("@GPT 开始")],
    maxMessages: 2,
  });
  assert.equal(result.completedMessages, 2);
  assert.equal(result.reason, "safety_limit");
});

test("stop aborts before another group member speaks", async () => {
  const controller = new AbortController();
  let calls = 0;
  const provider = fakeProvider("openai", "GPT");
  provider.generate = async () => {
    calls += 1;
    controller.abort("test");
    return "@GPT";
  };
  const result = await runGroupChat({
    providers: [provider],
    participantIds: ["openai"],
    history: [userMessage("你好")],
    signal: controller.signal,
  });
  assert.equal(calls, 1);
  assert.equal(result.reason, "stopped");
});

test("long-term memories are injected into an AI group member prompt", async () => {
  let systemPrompt = "";
  const provider = fakeProvider("openai", "GPT");
  provider.generate = async ({ system }) => { systemPrompt = system; return "记住了"; };
  await runGroupChat({
    providers: [provider],
    participantIds: ["openai"],
    history: [userMessage("给我建议")],
    memories: [{ id: "m1", text: "用户喜欢先看结论" }],
  });
  assert.match(systemPrompt, /用户喜欢先看结论/);
  assert.match(systemPrompt, /微信群或 Telegram 群/);
});

test("mention parsing supports labels, aliases and everyone", () => {
  const providers = [fakeProvider("openai", "GPT"), fakeProvider("claude-code", "Claude Code")];
  assert.deepEqual(extractMentions("@ChatGPT 请和 @Claude Code 讨论", providers).ids, ["openai", "claude-code"]);
  assert.equal(extractMentions("@所有人 来聊聊", providers).hasEveryone, true);
});
