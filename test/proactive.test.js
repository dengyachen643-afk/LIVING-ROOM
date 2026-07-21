import test from "node:test";
import assert from "node:assert/strict";
import { createProactiveScheduler, parseProactiveDecision } from "../src/proactive.js";
import { RoundtableStore } from "../src/store.js";

test("proactive decisions accept strict text or JSON and fail closed", () => {
  assert.deepEqual(parseProactiveDecision("ACTION: SKIP"), { action: "skip", content: "" });
  assert.deepEqual(parseProactiveDecision("ACTION: PRIVATE\n午饭吃了吗"), { action: "private", content: "午饭吃了吗" });
  assert.deepEqual(parseProactiveDecision('{"action":"group","content":"群里冒个泡"}'), { action: "group", content: "群里冒个泡" });
  assert.deepEqual(parseProactiveDecision("ACTION: PRIVATE\n不能发", { allowPrivate: false }), { action: "skip", content: "" });
  assert.deepEqual(parseProactiveDecision("随便说一句，没有路由"), { action: "skip", content: "" });
});

test("Gen proactive wake sees only Gen private context and can persist a private message", async () => {
  const store = new RoundtableStore({ filePath: "" });
  await store.addMessage({ id: "group-1", role: "user", channel: "group", author: "Okra", content: "群里消息" });
  await store.addMessage({ id: "gen-1", role: "user", channel: "gen", author: "用户", content: "Gen 私聊内容" });
  await store.addMessage({ id: "kimi-1", role: "user", channel: "kimi", author: "用户", content: "Kimi 私聊秘密" });
  await store.addMemory({ namespace: "g", text: "Gen 的记忆" });
  await store.addMemory({ namespace: "kimi", text: "Kimi 的秘密记忆" });
  let request;
  const provider = {
    id: "codex-cli", label: "Gen", kind: "CLI", model: "test", available: true,
    generate: async (input) => { request = input; return "ACTION: PRIVATE\n小O，午饭记得吃。"; },
  };
  const scheduler = createProactiveScheduler({
    env: { PROACTIVE_ENABLED: "true", PROACTIVE_QUIET_START: "00:00", PROACTIVE_QUIET_END: "00:00" },
    providers: [provider],
    store,
    activeRuns: new Map(),
    now: () => new Date("2026-07-20T04:00:00.000Z"),
  });

  const result = await scheduler.runNow("codex-cli");
  assert.equal(result.status, "sent");
  assert.equal(result.message.channel, "gen");
  assert.equal(result.message.proactive, true);
  assert.match(request.prompt, /Gen 私聊内容/u);
  assert.doesNotMatch(request.prompt, /Kimi 私聊秘密/u);
  assert.match(request.system, /Gen 的记忆/u);
  assert.match(request.system, /偶尔夹杂简短、自然的日语/u);
  assert.doesNotMatch(request.system, /Kimi 的秘密记忆/u);
  const snapshot = await store.getSnapshot();
  assert.equal(snapshot.messages.at(-1).content, "小O，午饭记得吃。");
});

test("K proactive wake cannot send privately and reads group context only", async () => {
  const store = new RoundtableStore({ filePath: "" });
  await store.addMessage({ id: "group-1", role: "user", channel: "group", content: "大家在吗" });
  await store.addMessage({ id: "gen-1", role: "user", channel: "gen", content: "别人的私聊" });
  let prompt = "";
  let output = "ACTION: PRIVATE\n越权私聊";
  const provider = {
    id: "anthropic", label: "K", kind: "API", model: "test", available: true,
    generate: async (input) => { prompt = input.prompt; return output; },
  };
  const scheduler = createProactiveScheduler({
    env: { PROACTIVE_ENABLED: "true", PROACTIVE_QUIET_START: "00:00", PROACTIVE_QUIET_END: "00:00" },
    providers: [provider], store, activeRuns: new Map(),
    now: () => new Date("2026-07-20T04:00:00.000Z"),
  });

  assert.equal((await scheduler.runNow("anthropic")).status, "skipped");
  assert.doesNotMatch(prompt, /别人的私聊/u);
  output = "ACTION: GROUP\n我来看看你们聊什么。";
  const sent = await scheduler.runNow("anthropic");
  assert.equal(sent.status, "sent");
  assert.equal(sent.message.channel, "group");
});

test("GLM proactive wake can choose its private chat without seeing another member's private context", async () => {
  const store = new RoundtableStore({ filePath: "" });
  await store.addMessage({ id: "group-1", role: "user", channel: "group", author: "Okra", content: "群里消息" });
  await store.addMessage({ id: "glm-1", role: "user", channel: "glm", author: "Okra", content: "GLM 私聊内容" });
  await store.addMessage({ id: "kimi-1", role: "user", channel: "kimi", author: "Okra", content: "Kimi 私聊秘密" });
  await store.addMemory({ namespace: "glm", text: "GLM 的记忆" });
  await store.addMemory({ namespace: "kimi", text: "Kimi 的秘密记忆" });
  let request;
  const provider = {
    id: "glm", label: "GLM", kind: "API", model: "glm-5.1", available: true,
    generate: async (input) => { request = input; return "ACTION: PRIVATE\n还醒着？"; },
  };
  const scheduler = createProactiveScheduler({
    env: { PROACTIVE_ENABLED: "true", PROACTIVE_QUIET_START: "00:00", PROACTIVE_QUIET_END: "00:00" },
    providers: [provider], store, activeRuns: new Map(),
    now: () => new Date("2026-07-20T04:00:00.000Z"),
  });
  const result = await scheduler.runNow("glm");
  assert.equal(result.status, "sent");
  assert.equal(result.message.channel, "glm");
  assert.match(request.prompt, /GLM 私聊内容/u);
  assert.doesNotMatch(request.prompt, /Kimi 私聊秘密/u);
  assert.match(request.system, /GLM 的记忆/u);
  assert.doesNotMatch(request.system, /Kimi 的秘密记忆/u);
  assert.match(request.system, /27 岁的男性，MBTI 是 ENTP/u);
  assert.doesNotMatch(request.system, /硅基生命|现实身体|线下经历|如实说明自己是.*AI/u);
  assert.match(request.system, /不要为了延伸对话.*二选一提问/u);
});

test("proactive wake skips quiet hours and any active foreground run", async () => {
  let calls = 0;
  const provider = {
    id: "kimi", label: "Kimi", kind: "API", model: "test", available: true,
    generate: async () => { calls += 1; return "ACTION: GROUP\n早"; },
  };
  const store = new RoundtableStore({ filePath: "" });
  const quiet = createProactiveScheduler({
    env: { PROACTIVE_ENABLED: "true", PROACTIVE_QUIET_START: "00:00", PROACTIVE_QUIET_END: "08:00" },
    providers: [provider], store, activeRuns: new Map(),
    now: () => new Date("2026-07-19T20:00:00.000Z"),
  });
  assert.equal((await quiet.runNow("kimi")).status, "quiet");

  const busyRuns = new Map([["foreground", new AbortController()]]);
  const busy = createProactiveScheduler({
    env: { PROACTIVE_ENABLED: "true", PROACTIVE_QUIET_START: "00:00", PROACTIVE_QUIET_END: "00:00" },
    providers: [provider], store, activeRuns: busyRuns,
  });
  assert.equal((await busy.runNow("kimi")).status, "busy");
  assert.equal(calls, 0);
});
