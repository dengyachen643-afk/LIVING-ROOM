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
    assert.ok(events.some((event) => event.type === "thinking_delta"));
    assert.equal(events.find((event) => event.type === "message").message.reasoning, "回忆用户偏好。");
    assert.equal(outbound.options.headers.authorization, "Bearer session-key");
    assert.match(outbound.body.messages[0].content, /用户喜欢被叫小朋友/);
    const state = await fetch(`${base}/api/state`).then((result) => result.json());
    assert.deepEqual(state.messages.map((message) => message.channel), ["kimi", "kimi"]);
    assert.ok(state.messages[0].readAt);
  }, {}, { fetchImpl });
});

test("Kimi private reply finishes before background memory maintenance", async () => {
  let calls = 0;
  let releaseCurator;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      const sse = ['data: {"choices":[{"delta":{"content":"回完了"}}]}', "data: [DONE]", ""].join("\n");
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }
    return new Promise((resolve) => {
      releaseCurator = () => resolve(new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        headers: { "content-type": "application/json" },
      }));
    });
  };
  await withServer([], async (base) => {
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
    releaseCurator();
    await new Promise((resolve) => setImmediate(resolve));
  }, { KIMI_AUTO_MEMORY: "true" }, { fetchImpl });
});

test("Gen private endpoint uses G memories and can write a vectorized memory", async () => {
  let request;
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
    const state = await fetch(`${base}/api/state`).then((result) => result.json());
    assert.deepEqual(state.messages.map((message) => message.channel), ["gen", "gen"]);
    assert.equal(state.memories.some((memory) => memory.text.includes("白色")), true);
  }, { GEN_PRIVATE_ENABLED: "true" }, { embeddingService, genGenerate });
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

test("Kimi API key can be saved server-side without being exposed by config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "roundtable-kimi-key-"));
  const keyFile = path.join(directory, "kimi-api-key.txt");
  try {
    await withServer([], async (base) => {
      const saved = await fetch(`${base}/api/kimi/key`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-kimi-once-for-all-devices" }),
      });
      assert.equal(saved.status, 200);
      assert.equal((await readFile(keyFile, "utf8")).trim(), "sk-kimi-once-for-all-devices");

      const config = await fetch(`${base}/api/config`).then((response) => response.json());
      assert.equal(config.kimiPrivate.envKeyAvailable, true);
      assert.equal(JSON.stringify(config).includes("sk-kimi-once-for-all-devices"), false);
    }, { ROUNDTABLE_PUBLIC_ACCESS: "true", KIMI_KEY_FILE: keyFile });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
