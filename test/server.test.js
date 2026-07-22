import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "../src/server.js";
import { RoundtableStore } from "../src/store.js";

async function withServer(providers, fn, env = {}, options = {}) {
  const server = createServer({
    env: { MODEL_TIMEOUT_SECONDS: "5", ...env },
    providers,
    store: new RoundtableStore({ filePath: "" }),
    ...options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try { await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function waitFor(predicate, { timeoutMs = 1_000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("condition was not met before timeout");
}

test("config endpoint never exposes credentials", async () => {
  await withServer([{ id: "gpt", label: "GPT", kind: "API", model: "test", available: true, unavailableReason: "", generate: async () => "ok" }], async (base) => {
    const payload = await fetch(`${base}/api/config`).then((response) => response.json());
    assert.deepEqual(payload.providers[0], { id: "gpt", label: "GPT", kind: "API", model: "test", available: true, unavailableReason: "" });
    assert.equal(JSON.stringify(payload).includes("API_KEY"), false);
  });
});

test("Kimi private endpoint accepts a session API key and persists reasoning separately", async () => {
  let outbound;
  const fetchImpl = async (url, options) => {
    outbound = { url, options, body: JSON.parse(options.body) };
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"回忆用户偏好。"}}]}',
      'data: {"choices":[{"delta":{"content":"当然记得 😊"}}]}',
      "data: [DONE]",
      "",
    ].join("\n");
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  };
  await withServer([], async (base) => {
    await fetch(`${base}/api/memories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "用户喜欢被叫小朋友", namespace: "kimi" }),
    });
    const response = await fetch(`${base}/api/kimi/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kimi-api-key": "session-key" },
      body: JSON.stringify({ sessionId: "private-1", text: "你还记得吗" }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.ok(events.some((event) => event.type === "typing" && event.author === "Kimi"));
    assert.ok(events.some((event) => event.type === "thinking_delta"));
    assert.equal(events.find((event) => event.type === "message").message.reasoning, "回忆用户偏好。");
    assert.equal(outbound.options.headers.authorization, "Bearer session-key");
    assert.deepEqual(outbound.body.thinking, { type: "disabled" });
    assert.match(outbound.body.messages[0].content, /用户喜欢被叫小朋友/);
    const state = await fetch(`${base}/api/state`).then((result) => result.json());
    assert.deepEqual(state.messages.map((message) => message.channel), ["kimi", "kimi"]);
    assert.ok(state.messages[0].readAt);
  }, {}, { fetchImpl });
});

test("GLM private endpoint stores a separate private conversation", async () => {
  let request;
  const glmStream = async (input) => {
    request = input;
    await input.onEvent({ type: "thinking_delta", delta: "在思考。" });
    await input.onEvent({ type: "content_delta", delta: "你好" });
    return { content: "你好", reasoning: "在思考。", model: "glm-5.1" };
  };
  await withServer([], async (base) => {
    const config = await fetch(`${base}/api/config`).then((response) => response.json());
    assert.equal(config.glmPrivate.model, "glm-5.1");
    assert.equal(JSON.stringify(config).includes("glm-secret"), false);
    const response = await fetch(`${base}/api/glm/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-glm-api-key": "glm-secret" },
      body: JSON.stringify({ sessionId: "glm-private-1", messageId: "glm-message-1", text: "你好" }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.ok(events.some((event) => event.type === "typing" && event.author === "Shin"));
    assert.equal(events.find((event) => event.type === "message").message.channel, "glm");
    assert.equal(request.apiKey, "glm-secret");
    const state = await fetch(`${base}/api/state`).then((result) => result.json());
    assert.deepEqual(state.messages.map((message) => message.channel), ["glm", "glm"]);
  }, {}, { glmStream });
});

test("GLM private chat can create and vectorize its own long-term memory", async () => {
  const store = new RoundtableStore({ filePath: "" });
  let curatorBody;
  const glmStream = async () => ({ content: "好，我记下这件事。", reasoning: "", model: "glm-5.1" });
  const fetchImpl = async (_url, options) => {
    curatorBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { tool_calls: [{
        id: "glm-memory-call",
        type: "function",
        function: {
          name: "create_memory",
          arguments: JSON.stringify({ text: "Okra 喜欢蓝色", importance: 4 }),
        },
      }] } }],
    }), { headers: { "content-type": "application/json" } });
  };
  const embeddingService = { model: "test-embedding", embed: async () => [0.1, 0.2, 0.3] };
  await withServer([], async (base) => {
    await fetch(`${base}/api/glm/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-glm-api-key": "glm-secret" },
      body: JSON.stringify({ sessionId: "glm-memory-private", text: "请记住我喜欢蓝色" }),
    }).then((response) => response.text());
    await waitFor(async () => (await store.listMemories({ namespace: "glm" })).length === 1);
  }, { GLM_AUTO_MEMORY: "true" }, { store, glmStream, fetchImpl, embeddingService });
  const [memory] = await store.listMemories({ namespace: "glm" });
  assert.equal(curatorBody.model, "glm-5.1");
  assert.deepEqual(curatorBody.thinking, { type: "disabled" });
  assert.equal(memory.text, "Okra 喜欢蓝色");
  assert.equal(memory.source, "glm-auto");
  assert.equal(memory.vectorStatus, "indexed");
});

test("a failed Kimi private reply is persisted and available through status recovery", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
  await withServer([], async (base) => {
    const response = await fetch(`${base}/api/kimi/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kimi-api-key": "session-key" },
      body: JSON.stringify({ sessionId: "kimi-failure-session", messageId: "kimi-failure-1", text: "还在吗" }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    const failure = events.find((event) => event.type === "message")?.message;
    assert.equal(failure.replyToId, "kimi-failure-1");
    assert.match(failure.content, /没有回复成功/u);
    assert.equal(events.at(-1).reason, "failed");

    const status = await fetch(`${base}/api/kimi/status?sessionId=kimi-failure-session&messageId=kimi-failure-1`).then((result) => result.json());
    assert.equal(status.running, false);
    assert.equal(status.knownUser, true);
    assert.equal(status.message.id, failure.id);
  }, {}, { fetchImpl });
});

test("ordinary Kimi replies no longer pay for legacy per-batch memory maintenance", async () => {
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    if (JSON.parse(options.body).stream) {
      const sse = ['data: {"choices":[{"delta":{"content":"回完了"}}]}', "data: [DONE]", ""].join("\n");
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ choices: [{ message: {} }] }), {
      headers: { "content-type": "application/json" },
    });
  };
  await withServer([], async (base) => {
    await fetch(`${base}/api/kimi/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kimi-api-key": "session-key" },
      body: JSON.stringify({ sessionId: "kimi-background-warmup", text: "warmup" }),
    }).then((result) => result.text());
    const response = await fetch(`${base}/api/kimi/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kimi-api-key": "session-key" },
      body: JSON.stringify({ sessionId: "kimi-background", text: "你好" }),
    });
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.equal(events.at(-1).type, "chat_done");
    assert.equal(events.find((event) => event.type === "message").message.content, "回完了");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 2);
  }, { KIMI_AUTO_MEMORY: "true", KIMI_MEMORY_BATCH_SIZE: "2" }, { fetchImpl });
});

test("Gen private endpoint uses G memories and can write a vectorized memory", async () => {
  let request;
  const store = new RoundtableStore({ filePath: "" });
  await store.addMessage({
    id: "earlier-group-kimi",
    role: "assistant",
    author: "Kimi",
    providerId: "kimi",
    channel: "group",
    content: "这是群里的上一句话",
  });
  const genGenerate = async (input) => {
    request = input;
    input.onEvent({ type: "typing", author: "Gen" });
    return {
      content: "嗯，在呢。",
      model: "gen-test",
      memoryActions: [{ type: "create", id: "", text: "用户喜欢白色的 Gen 私聊界面", tags: ["偏好"], importance: 4, reason: "用户明确提出" }],
    };
  };
  const embeddingService = { model: "test-embedding", embed: async () => [1, 0] };
  await withServer([], async (base) => {
    await fetch(`${base}/api/memories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "G老师也称 Gen", namespace: "g" }),
    });
    const response = await fetch(`${base}/api/gen/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "gen-private-1", text: "喂，在吗" }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.ok(events.some((event) => event.type === "typing"));
    assert.equal(events.find((event) => event.type === "message").message.author, "Gen");
    assert.equal(events.find((event) => event.type === "memory_changed").memory.vectorStatus, "indexed");
    assert.match(request.memories[0].text, /Gen/);
    assert.equal(request.reasoningEffort, "medium");
    assert.equal(request.history.some((message) => message.channel === "group" && message.author === "Kimi"), true);
    const state = await fetch(`${base}/api/state`).then((result) => result.json());
    assert.deepEqual(state.messages.map((message) => message.channel), ["group", "gen", "gen"]);
    assert.equal(state.memories.some((memory) => memory.text.includes("白色")), true);
  }, { GEN_PRIVATE_ENABLED: "true" }, { embeddingService, genGenerate, store });
});

test("Gen private endpoint recalls relevant conversation older than its recent window", async () => {
  let request;
  const store = new RoundtableStore({ filePath: "" });
  await store.addMessage({
    id: "old-reading",
    role: "user",
    author: "用户",
    channel: "gen",
    content: "我更喜欢结构紧凑的短篇小说",
  });
  for (let index = 0; index < 26; index += 1) {
    await store.addMessage({
      id: `recent-${index}`,
      role: "user",
      author: "用户",
      channel: "gen",
      content: `后来聊的第 ${index} 件事`,
    });
  }
  const embeddingService = {
    model: "test-embedding",
    embed: async () => [1, 0],
    embedMany: async (texts) => texts.map((text) => (/短篇小说/u.test(text) ? [1, 0] : [0, 1])),
  };
  const genGenerate = async (input) => {
    request = input;
    return { content: "我找回来了。", model: "gen-test", memoryActions: [] };
  };
  await withServer([], async (base) => {
    await fetch(`${base}/api/gen/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "gen-recall", text: "记一下之前有关我阅读偏好的信息" }),
    }).then((response) => response.text());
  }, { GEN_PRIVATE_ENABLED: "true" }, { embeddingService, genGenerate, store });
  assert.equal(request.history.slice(-24).some((message) => message.id === "old-reading"), false);
  assert.equal(request.recalledHistory.some((message) => message.id === "old-reading"), true);
});

test("Gen chat continues after its page connection closes", async () => {
  const store = new RoundtableStore({ filePath: "" });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const genGenerate = async () => {
    await gate;
    return { content: "Gen 后台完成", model: "test", toolCalls: [], memoryActions: [] };
  };
  await withServer([], async (base) => {
    const abort = new AbortController();
    const response = await fetch(`${base}/api/gen/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "gen-background-chat", messageId: "gen-background-user", text: "你慢慢回", mode: "chat" }),
      signal: abort.signal,
    });
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /"type":"accepted"/u);
    abort.abort();
    await reader.cancel().catch(() => {});
    release();
    await waitFor(async () => (await store.getSnapshot()).messages.some((message) => message.content === "Gen 后台完成"));
    const status = await fetch(`${base}/api/gen/status?sessionId=gen-background-chat&messageId=gen-background-user`).then((result) => result.json());
    assert.equal(status.running, false);
    assert.equal(status.message.content, "Gen 后台完成");
  }, { GEN_PRIVATE_ENABLED: "true" }, { store, genGenerate });
});

test("Gen work mode accepts only configured workspace IDs", async () => {
  let request;
  let calls = 0;
  const genGenerate = async (input) => {
    calls += 1;
    request = input;
    return { content: "任务完成。", model: "gen-test", memoryActions: [], toolCalls: [] };
  };
  const projectDir = path.resolve("D:/G-Teacher");
  const workspaceDir = path.resolve("D:/Gen-Workspace");
  await withServer([], async (base) => {
    const config = await fetch(`${base}/api/config`).then((response) => response.json());
    assert.deepEqual(config.genPrivate.workspaces, [
      { id: "living-room", label: "LIVING ROOM" },
      { id: "gen-workspace", label: "Gen 工作区" },
    ]);
    assert.equal(JSON.stringify(config).includes(projectDir), false);
    assert.equal(JSON.stringify(config).includes(workspaceDir), false);

    const invalid = await fetch(`${base}/api/gen/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "gen-work-invalid", text: "做事", mode: "work", workspaceId: "D:/" }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(calls, 0);

    const valid = await fetch(`${base}/api/gen/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "gen-work-valid", text: "把测试跑通", mode: "work", workspaceId: "gen-workspace" }),
    });
    assert.equal(valid.status, 200);
    const events = (await valid.text()).trim().split("\n").map(JSON.parse);
    assert.equal(request.mode, "work");
    assert.equal(request.reasoningEffort, "high");
    assert.equal(request.workspaceDir, workspaceDir);
    assert.equal(events.find((event) => event.type === "accepted").message.workspaceLabel, "Gen 工作区");
    assert.equal(events.find((event) => event.type === "message").message.mode, "work");
    const messageId = events.find((event) => event.type === "accepted").message.id;
    const status = await fetch(`${base}/api/gen/status?sessionId=gen-work-valid&messageId=${encodeURIComponent(messageId)}`).then((response) => response.json());
    assert.equal(status.running, false);
    assert.equal(status.knownUser, true);
    assert.equal(status.message.content, "任务完成。");
  }, {
    GEN_PRIVATE_ENABLED: "true",
    GEN_WORK_ENABLED: "true",
    GEN_PROJECT_DIR: projectDir,
    GEN_WORKSPACE_DIR: workspaceDir,
  }, { genGenerate });
});

test("Gen work queues guidance without interrupting and processes it before replying", async () => {
  let calls = 0;
  let releaseFirst;
  const requests = [];
  const firstPass = new Promise((resolve) => { releaseFirst = resolve; });
  const genGenerate = async (input) => {
    calls += 1;
    requests.push(input);
    if (calls === 1) await firstPass;
    return {
      content: calls === 1 ? "初步完成。" : "已按补充指令调整完成。",
      model: "gen-test",
      memoryActions: [],
      toolCalls: [],
    };
  };
  await withServer([], async (base) => {
    const workResponse = await fetch(`${base}/api/gen/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "guided-work-session",
        messageId: "guided-work-message",
        text: "先完成任务",
        mode: "work",
        workspaceId: "living-room",
      }),
    });
    await waitFor(() => calls === 1);
    const guidance = await fetch(`${base}/api/gen/guide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "guided-work-session",
        messageId: "guided-work-followup",
        text: "颜色改成白色，不要停下",
      }),
    });
    assert.equal(guidance.status, 202);
    assert.equal((await guidance.json()).message.mode, "guide");
    releaseFirst();

    const events = (await workResponse.text()).trim().split("\n").map(JSON.parse);
    assert.equal(calls, 2);
    assert.match(requests[1].prompt, /颜色改成白色/u);
    assert.equal(requests[1].windowsSandbox, "unelevated");
    assert.equal(events.find((event) => event.type === "message").message.content, "已按补充指令调整完成。");
    const state = await fetch(`${base}/api/state`).then((result) => result.json());
    assert.deepEqual(state.messages.filter((message) => message.channel === "gen").map((message) => message.mode), ["work", "guide", "work"]);
  }, {
    GEN_PRIVATE_ENABLED: "true",
    GEN_WORK_ENABLED: "true",
    GEN_WINDOWS_SANDBOX: "unelevated",
  }, { genGenerate });
});

test("a failed Gen work task is saved as a recoverable result", async () => {
  const genGenerate = async () => { throw new Error("测试命令失败"); };
  await withServer([], async (base) => {
    const response = await fetch(`${base}/api/gen/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "recoverable-failure",
        messageId: "client-work-message-1",
        text: "执行任务",
        mode: "work",
        workspaceId: "living-room",
      }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.match(events.find((event) => event.type === "message").message.content, /任务没有完成：测试命令失败/u);

    const status = await fetch(`${base}/api/gen/status?sessionId=recoverable-failure&messageId=client-work-message-1`).then((result) => result.json());
    assert.equal(status.running, false);
    assert.match(status.message.content, /测试命令失败/u);
  }, {
    GEN_PRIVATE_ENABLED: "true",
    GEN_WORK_ENABLED: "true",
  }, { genGenerate });
});

test("chat endpoint streams a bounded group reply chain", async () => {
  const provider = { id: "gpt", label: "GPT", kind: "API", model: "test", available: true, unavailableReason: "", generate: async () => "hello" };
  await withServer([provider], async (base) => {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", text: "@GPT hi", participants: ["gpt"], maxMessages: 8 }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.equal(events.filter((event) => event.type === "message").length, 1);
    assert.equal(events.at(-1).type, "chat_done");
    assert.equal(events.at(-1).reason, "idle");
  });
});

test("group generation survives a disconnected client and persists the completed reply", async () => {
  const store = new RoundtableStore({ filePath: "" });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const provider = {
    id: "gpt", label: "GPT", kind: "API", model: "test", available: true, unavailableReason: "",
    generate: async () => { await gate; return "后台完成的回复"; },
  };
  await withServer([provider], async (base) => {
    const abort = new AbortController();
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "background-group", messageId: "background-user-1", text: "切到后台", participants: ["gpt"] }),
      signal: abort.signal,
    });
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /"type":"accepted"/u);
    const running = await fetch(`${base}/api/group/status?sessionId=background-group&messageId=background-user-1`).then((result) => result.json());
    assert.equal(running.running, true);
    assert.equal(running.knownUser, true);
    abort.abort();
    await reader.cancel().catch(() => {});
    release();
    await waitFor(async () => (await store.getSnapshot()).messages.some((message) => message.channel === "group" && message.content === "后台完成的回复"));
    const finished = await fetch(`${base}/api/group/status?sessionId=background-group&messageId=background-user-1`).then((result) => result.json());
    assert.equal(finished.running, false);
    assert.equal(finished.knownUser, true);
  }, {}, { store });
});

test("group chat gives Gen only its own private context", async () => {
  const store = new RoundtableStore({ filePath: "" });
  await store.addMessage({ id: "private-kimi", role: "user", channel: "kimi", content: "Kimi 私聊秘密" });
  await store.addMessage({ id: "private-gen", role: "user", channel: "gen", content: "Gen 私聊秘密" });
  let prompt;
  const provider = {
    id: "openai", label: "Gen", kind: "API", model: "test", available: true, unavailableReason: "",
    generate: async (input) => { prompt = input.prompt; return "群聊回复"; },
  };
  await withServer([provider], async (base) => {
    await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "isolated-group", text: "大家好", participants: ["openai"] }),
    }).then((response) => response.text());
  }, {}, { store });
  assert.match(prompt, /Gen 私聊秘密/u);
  assert.doesNotMatch(prompt, /Kimi 私聊秘密/u);
});

test("group members can create and update their own long-term memories", async () => {
  const store = new RoundtableStore({ filePath: "" });
  let memoryId = "";
  let mode = "create";
  const provider = {
    id: "kimi", label: "Kimi", kind: "API", model: "test", available: true, unavailableReason: "",
    generate: async () => mode === "create" ? "我记住了你喜欢雨天。" : "好，改成你更喜欢雪天。",
  };
  const fetchImpl = async () => {
    const call = mode === "create"
      ? { name: "create_memory", arguments: JSON.stringify({ text: "用户喜欢雨天", importance: 4 }) }
      : { name: "update_memory", arguments: JSON.stringify({ id: memoryId, text: "用户更喜欢雪天", importance: 4 }) };
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: "memory-call", type: "function", function: call }] } }] }), {
      headers: { "content-type": "application/json" },
    });
  };
  await withServer([provider], async (base) => {
    const send = (sessionId, text) => fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, text, participants: ["kimi"] }),
    }).then((response) => response.text());
    await send("group-memory-create", "Kimi，记住我喜欢雨天");
    await waitFor(async () => (await store.listMemories({ namespace: "kimi" })).length === 1);
    memoryId = (await store.listMemories({ namespace: "kimi" }))[0].id;
    mode = "update";
    await send("group-memory-update", "更正一下，我更喜欢雪天");
    await waitFor(async () => (await store.listMemories({ namespace: "kimi" }))[0]?.text.includes("雪天"));
  }, { GROUP_AUTO_MEMORY: "true", MOONSHOT_API_KEY: "test-key" }, { store, fetchImpl });
  const memories = await store.listMemories({ namespace: "kimi" });
  assert.equal(memories.length, 1);
  assert.equal(memories[0].text, "用户更喜欢雪天");
  assert.equal(memories[0].source, "kimi-group-auto");
});

test("GLM uses its own API to maintain GLM memories from the group", async () => {
  const store = new RoundtableStore({ filePath: "" });
  let curatorUrl = "";
  const provider = {
    id: "glm", label: "GLM", kind: "API", model: "glm-5.1", available: true, unavailableReason: "",
    generate: async () => "好，我会记着。",
  };
  const fetchImpl = async (url) => {
    curatorUrl = String(url);
    return new Response(JSON.stringify({
      choices: [{ message: { tool_calls: [{
        id: "glm-group-memory",
        type: "function",
        function: {
          name: "create_memory",
          arguments: JSON.stringify({ text: "Okra 喜欢爵士乐", importance: 4 }),
        },
      }] } }],
    }), { headers: { "content-type": "application/json" } });
  };
  await withServer([provider], async (base) => {
    await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "glm-group-memory",
        text: "GLM，请记住我喜欢爵士乐",
        participants: ["glm"],
      }),
    }).then((response) => response.text());
    await waitFor(async () => (await store.listMemories({ namespace: "glm" })).length === 1);
  }, { GROUP_AUTO_MEMORY: "true", GLM_API_KEY: "glm-secret" }, { store, fetchImpl });
  const [memory] = await store.listMemories({ namespace: "glm" });
  assert.match(curatorUrl, /open\.bigmodel\.cn/u);
  assert.equal(memory.text, "Okra 喜欢爵士乐");
  assert.equal(memory.source, "glm-group-auto");
});

test("ordinary group chat waits for the 30-round reviewer instead of legacy batching", async () => {
  let curatorCalls = 0;
  const provider = {
    id: "kimi", label: "Kimi", kind: "API", model: "test", available: true, unavailableReason: "",
    generate: async () => "reply",
  };
  const fetchImpl = async () => {
    curatorCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: {} }] }), {
      headers: { "content-type": "application/json" },
    });
  };
  await withServer([provider], async (base) => {
    const send = (index) => fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: `group-batch-${index}`, text: `ordinary ${index}`, participants: ["kimi"] }),
    }).then((response) => response.text());
    await send(1);
    await send(2);
    await send(3);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(curatorCalls, 0);
    await send(4);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(curatorCalls, 0);
  }, {
    GROUP_AUTO_MEMORY: "true",
    GROUP_MEMORY_BATCH_SIZE: "4",
    MOONSHOT_API_KEY: "test-key",
  }, { fetchImpl });
});

test("chat endpoint stores multimodal images and serves them back", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "roundtable-server-images-"));
  let receivedImages;
  const provider = {
    id: "kimi",
    label: "Kimi",
    kind: "API",
    model: "test",
    available: true,
    unavailableReason: "",
    generate: async ({ images }) => { receivedImages = images; return "看到了"; },
  };
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  try {
    await withServer([provider], async (base) => {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "image-room",
          text: "看看这个",
          participants: ["kimi"],
          images: [{ name: "pixel.png", mimeType: "image/png", dataUrl: `data:image/png;base64,${png}` }],
        }),
      });
      const events = (await response.text()).trim().split("\n").map(JSON.parse);
      const accepted = events.find((event) => event.type === "accepted").message;
      assert.equal(receivedImages[0].mimeType, "image/png");
      assert.match(accepted.attachments[0].url, /^\/uploads\//u);
      const imageResponse = await fetch(`${base}${accepted.attachments[0].url}`);
      assert.equal(imageResponse.status, 200);
      assert.equal(imageResponse.headers.get("content-type"), "image/png");
      assert.ok((await imageResponse.arrayBuffer()).byteLength > 0);
      const thumbnailResponse = await fetch(`${base}${accepted.attachments[0].url}?w=192`);
      assert.equal(thumbnailResponse.status, 200);
      assert.equal(thumbnailResponse.headers.get("content-type"), "image/webp");
      assert.match(thumbnailResponse.headers.get("cache-control"), /immutable/u);
      assert.ok((await thumbnailResponse.arrayBuffer()).byteLength > 0);
      const uiStateResponse = await fetch(`${base}/api/ui-state`);
      const uiState = await uiStateResponse.json();
      assert.ok(uiState.messages.length <= 4);
      assert.equal(uiState.messages.some((message) => "content" in message), false);
    }, { UPLOAD_DIR: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stop endpoint aborts the active speaker and prevents later turns", async () => {
  const provider = {
    id: "gpt",
    label: "GPT",
    kind: "API",
    model: "test",
    available: true,
    unavailableReason: "",
    generate: ({ signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve("too late"), 10_000);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        const error = new Error("stopped");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  };
  await withServer([provider], async (base) => {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "stop-me", text: "hi", participants: ["gpt"], rounds: 4 }),
    });
    const stopped = await fetch(`${base}/api/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "stop-me" }),
    }).then((result) => result.json());
    assert.equal(stopped.stopped, true);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.equal(events.some((event) => event.type === "message"), false);
    assert.equal(events.at(-1).reason, "stopped");
  });
});

test("memory endpoints persist notes and server-side chat history", async () => {
  const provider = { id: "gpt", label: "GPT", kind: "API", model: "test", available: true, unavailableReason: "", generate: async () => "remembered reply" };
  await withServer([provider], async (base) => {
    const created = await fetch(`${base}/api/memories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "用户喜欢先看结论" }),
    }).then((response) => response.json());
    assert.equal(created.memory.text, "用户喜欢先看结论");

    await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "memory-room", text: "你好", participants: ["gpt"], rounds: 1 }),
    }).then((response) => response.text());

    const state = await fetch(`${base}/api/state`).then((response) => response.json());
    assert.equal(state.memories.length, 1);
    assert.deepEqual(state.messages.map((message) => message.role), ["user", "assistant"]);
  });
});

test("GPT memory token is scoped to searchable memory CRUD", async () => {
  await withServer([], async (base) => {
    const headers = { authorization: "Bearer gpt-secret", "content-type": "application/json" };
    assert.equal((await fetch(`${base}/api/config`, { headers })).status, 401);

    const createdResponse = await fetch(`${base}/api/memories`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "用户喜欢黑咖啡", namespace: "gpt", tags: ["偏好"], source: "chatgpt" }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();

    const search = await fetch(`${base}/api/memories?query=${encodeURIComponent("咖啡")}&namespace=g`, { headers })
      .then((response) => response.json());
    assert.equal(search.memories[0].id, created.memory.id);
    assert.equal(search.memories[0].namespace, "g");
    assert.equal(search.searchMode, "keyword");

    const updated = await fetch(`${base}/api/memories/${created.memory.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ importance: 5 }),
    }).then((response) => response.json());
    assert.equal(updated.memory.importance, 5);
  }, { ROUNDTABLE_ACCESS_TOKEN: "local-secret", GPT_MEMORY_TOKEN: "gpt-secret" });
});

test("G memory editor token cannot read or mutate another assistant's memories", async () => {
  await withServer([], async (base) => {
    const ownerHeaders = { authorization: "Bearer local-secret", "content-type": "application/json" };
    const gHeaders = { authorization: "Bearer gpt-secret", "content-type": "application/json" };
    const kimi = await fetch(`${base}/api/memories`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ text: "Kimi only", namespace: "kimi" }),
    }).then((response) => response.json());

    assert.equal((await fetch(`${base}/api/memories?namespace=kimi`, { headers: gHeaders })).status, 403);
    assert.equal((await fetch(`${base}/api/memories/${kimi.memory.id}`, {
      method: "PATCH",
      headers: gHeaders,
      body: JSON.stringify({ text: "changed" }),
    })).status, 403);
    assert.equal((await fetch(`${base}/api/memories/${kimi.memory.id}`, {
      method: "DELETE",
      headers: gHeaders,
    })).status, 403);

    const ownerView = await fetch(`${base}/api/memories?namespace=kimi`, { headers: ownerHeaders }).then((response) => response.json());
    assert.equal(ownerView.memories[0].text, "Kimi only");
  }, { ROUNDTABLE_ACCESS_TOKEN: "local-secret", GPT_MEMORY_TOKEN: "gpt-secret" });
});

test("G memory editor is available at its short URL", async () => {
  await withServer([], async (base) => {
    const response = await fetch(`${base}/g-memory`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /G老师的记忆/);
  });
});

test("OpenAPI schema uses the forwarded HTTPS origin and exposes memory actions only", async () => {
  await withServer([], async (base) => {
    const schema = await fetch(`${base}/openapi.json`, {
      headers: { "x-forwarded-host": "memory.example.test", "x-forwarded-proto": "https" },
    }).then((response) => response.json());
    assert.equal(schema.servers[0].url, "https://memory.example.test");
    assert.ok(schema.paths["/api/memories"]);
    assert.equal(schema.paths["/api/chat"], undefined);
    assert.equal(typeof schema.components.schemas, "object");
    assert.equal(schema.components.schemas.Memory.type, "object");
    assert.equal(schema.components.schemas.WritableMemory.type, "object");
    assert.equal(schema.components.securitySchemes.bearerAuth.scheme, "bearer");
  });
});

test("configured access token protects every API route", async () => {
  await withServer([], async (base) => {
    assert.equal((await fetch(`${base}/api/config`)).status, 401);
    const response = await fetch(`${base}/api/config`, { headers: { authorization: "Bearer local-secret" } });
    assert.equal(response.status, 200);
  }, { ROUNDTABLE_ACCESS_TOKEN: "local-secret" });
});

test("public access mode opens chat and memory APIs without the site password", async () => {
  await withServer([], async (base) => {
    const config = await fetch(`${base}/api/config`);
    assert.equal(config.status, 200);
    assert.equal((await config.json()).publicAccess, true);

    const created = await fetch(`${base}/api/memories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "direct mobile access", namespace: "kimi" }),
    });
    assert.equal(created.status, 201);
  }, {
    ROUNDTABLE_ACCESS_TOKEN: "still-configured-but-optional",
    GPT_MEMORY_TOKEN: "g-memory-secret",
    ROUNDTABLE_PUBLIC_ACCESS: "true",
  });
});

test("history API searches the durable archive and opens surrounding context", async () => {
  await withServer([], async (base) => {
    const imported = await fetch(`${base}/api/messages/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [
        { id: "history-1", role: "user", author: "Okra", channel: "group", content: "想找一盏琥珀色的灯", createdAt: "2026-07-20T12:00:00.000Z" },
        { id: "history-2", role: "assistant", author: "Gen", providerId: "codex-cli", channel: "group", content: "我记得那盏灯", createdAt: "2026-07-20T12:01:00.000Z" },
      ] }),
    });
    assert.equal(imported.status, 200);
    const search = await fetch(`${base}/api/history?query=${encodeURIComponent("琥珀色")}&channel=group`).then((response) => response.json());
    assert.deepEqual(search.entries.map((message) => message.id), ["history-1"]);
    const byMember = await fetch(`${base}/api/history?member=gen&channel=group`).then((response) => response.json());
    assert.deepEqual(byMember.entries.map((message) => message.id), ["history-2"]);
    const around = await fetch(`${base}/api/history?around=history-1&radius=3`).then((response) => response.json());
    assert.deepEqual(around.entries.map((message) => message.id), ["history-1", "history-2"]);
  }, { PROACTIVE_ENABLED: "false", MOMENTS_ENABLED: "false" });
});

test("member avatars upload to server storage, appear in shared state, and can be reset", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "roundtable-avatars-"));
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  try {
    await withServer([], async (base) => {
      const uploaded = await fetch(`${base}/api/avatars/kimi`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: { name: "kimi.png", mimeType: "image/png", dataUrl: `data:image/png;base64,${png}` } }),
      });
      assert.equal(uploaded.status, 200);
      const avatar = (await uploaded.json()).avatar;
      assert.match(avatar.url, /^\/uploads\/.+\.png$/u);
      const state = await fetch(`${base}/api/state`).then((response) => response.json());
      assert.equal(state.avatars.kimi, avatar.url);
      assert.equal((await fetch(`${base}${avatar.url}`)).status, 200);

      const shin = await fetch(`${base}/api/avatars/glm`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: { name: "shin.png", mimeType: "image/png", dataUrl: `data:image/png;base64,${png}` } }),
      });
      assert.equal(shin.status, 200);
      const stateWithShin = await fetch(`${base}/api/state`).then((response) => response.json());
      assert.match(stateWithShin.avatars.glm, /^\/uploads\/.+\.png$/u);

      const signatureResponse = await fetch(`${base}/api/profiles/okra/signature`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature: "慢慢生活。" }),
      });
      assert.equal(signatureResponse.status, 200);
      const stateWithSignature = await fetch(`${base}/api/state`).then((response) => response.json());
      assert.equal(stateWithSignature.signatures.okra, "慢慢生活。");

      const backgroundResponse = await fetch(`${base}/api/chat-backgrounds/kimi`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: { name: "background.png", mimeType: "image/png", dataUrl: `data:image/png;base64,${png}` } }),
      });
      assert.equal(backgroundResponse.status, 200);
      const background = (await backgroundResponse.json()).background;
      const stateWithBackground = await fetch(`${base}/api/state`).then((response) => response.json());
      assert.equal(stateWithBackground.chatBackgrounds.kimi, background.url);
      assert.equal((await fetch(`${base}${background.url}`)).status, 200);

      const backgroundReset = await fetch(`${base}/api/chat-backgrounds/kimi`, { method: "DELETE" });
      assert.equal(backgroundReset.status, 200);
      const stateWithoutBackground = await fetch(`${base}/api/state`).then((response) => response.json());
      assert.equal(stateWithoutBackground.chatBackgrounds.kimi, undefined);
      assert.equal((await fetch(`${base}${background.url}`)).status, 404);

      const reset = await fetch(`${base}/api/avatars/kimi`, { method: "DELETE" });
      assert.equal(reset.status, 200);
      const cleared = await fetch(`${base}/api/state`).then((response) => response.json());
      assert.equal(cleared.avatars.kimi, undefined);
      assert.equal((await fetch(`${base}${avatar.url}`)).status, 404);
    }, { UPLOAD_DIR: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Kimi API key can be saved server-side without being exposed by config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "roundtable-kimi-key-"));
  const keyFile = path.join(directory, "kimi-api-key.txt");
  try {
    await withServer([], async (base) => {
      const saved = await fetch(`${base}/api/kimi/key`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "test-kimi-key-once-for-all-devices" }),
      });
      assert.equal(saved.status, 200);
      assert.equal((await readFile(keyFile, "utf8")).trim(), "test-kimi-key-once-for-all-devices");

      const config = await fetch(`${base}/api/config`).then((response) => response.json());
      assert.equal(config.kimiPrivate.envKeyAvailable, true);
      assert.equal(JSON.stringify(config).includes("test-kimi-key-once-for-all-devices"), false);
    }, { ROUNDTABLE_PUBLIC_ACCESS: "true", KIMI_KEY_FILE: keyFile });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
