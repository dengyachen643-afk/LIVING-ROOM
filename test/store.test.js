import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { RoundtableStore } from "../src/store.js";

test("RoundtableStore persists messages and long-term memories", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sota-roundtable-"));
  const filePath = path.join(directory, "state.json");
  let store;
  let reopened;
  try {
    store = new RoundtableStore({ filePath });
    await store.addMessage({ id: "u1", role: "user", content: "hello" });
    const memory = await store.addMemory("Keep answers concise");
    await store.setAvatar("gen", "/uploads/gen-avatar.png");
    await store.setProfileSignature("okra", "在场，也在生活。 ");
    await store.setProfileSignature("gen", "一二三四五六七八九十一二三四五六七");
    await store.setChatBackground("gen", "/uploads/gen-background.jpg");

    reopened = new RoundtableStore({ filePath });
    const snapshot = await reopened.getSnapshot();
    assert.equal(snapshot.messages[0].content, "hello");
    assert.equal(snapshot.memories[0].id, memory.id);
    assert.equal(snapshot.avatars.gen, "/uploads/gen-avatar.png");
    assert.equal(snapshot.signatures.okra, "在场，也在生活。");
    assert.equal([...snapshot.signatures.gen].length, 15);
    assert.equal(snapshot.chatBackgrounds.gen, "/uploads/gen-background.jpg");
    const persisted = await readFile(filePath, "utf8");
    assert.doesNotThrow(() => JSON.parse(persisted));
  } finally {
    store?.close();
    reopened?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("chat display stays bounded while the SQLite archive keeps and searches every message", async () => {
  const store = new RoundtableStore({ filePath: "", archiveFilePath: ":memory:" });
  const messages = Array.from({ length: 420 }, (_, index) => ({
    id: `archive-${String(index).padStart(3, "0")}`,
    role: index % 2 ? "assistant" : "user",
    author: index % 2 ? "Gen" : "Okra",
    providerId: index % 2 ? "codex-cli" : "",
    channel: index % 3 ? "group" : "gen",
    content: index === 5 ? "一枚只出现一次的银色书签" : `长期记录 ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  }));
  await store.importMessages(messages);
  assert.equal((await store.getSnapshot()).messages.length, 400);

  const search = await store.searchArchivedMessages({ query: "银色书签" });
  assert.equal(search.length, 1);
  assert.equal(search[0].id, "archive-005");
  const genMessages = await store.searchArchivedMessages({ member: "gen", channel: "gen", limit: 10 });
  assert.ok(genMessages.length > 0);
  assert.ok(genMessages.every((message) => message.role === "assistant" && message.providerId === "codex-cli"));
  const around = await store.getArchivedMessageContext("archive-005", 2);
  assert.equal(around.some((message) => message.id === "archive-005"), true);
  const older = await store.listArchivedMessages({ channel: "gen", limit: 100 });
  assert.equal(older.entries.length, 100);
  store.close();
});

test("RoundtableStore keeps image-only messages and tool activity", async () => {
  const store = new RoundtableStore({ filePath: "" });
  await store.addMessage({
    id: "image-1",
    role: "user",
    content: "",
    attachments: [{ type: "image", name: "photo.png", mimeType: "image/png", size: 42, url: "/uploads/photo.png" }],
  });
  await store.addMessage({
    id: "assistant-1",
    role: "assistant",
    content: "找到了",
    toolCalls: [{ name: "web_search", label: "联网搜索", status: "done" }],
  });
  const snapshot = await store.getSnapshot();
  assert.equal(snapshot.messages[0].attachments[0].url, "/uploads/photo.png");
  assert.equal(snapshot.messages[1].toolCalls[0].name, "web_search");
});

test("memories support GPT namespaces, updates and keyword search", async () => {
  const store = new RoundtableStore({ filePath: "" });
  const memory = await store.addMemory({
    text: "用户写作时喜欢先给结论",
    namespace: "gpt",
    tags: ["写作", "偏好"],
    importance: 5,
    source: "chatgpt",
  });
  await store.addMemory({ text: "项目使用 Node.js", namespace: "shared", tags: ["项目"] });

  const matches = await store.listMemories({ query: "结论", namespace: "gpt" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, memory.id);
  assert.equal(matches[0].source, "chatgpt");
  assert.equal(matches[0].vectorStatus, "not_indexed");

  const updated = await store.updateMemory(memory.id, { text: "用户喜欢先给一句结论", tags: ["表达"] });
  assert.equal(updated.text, "用户喜欢先给一句结论");
  assert.deepEqual(updated.tags, ["表达"]);
  assert.equal((await store.listMemories({ query: "一句" }))[0].id, memory.id);
});

test("memories support vector indexing and semantic ranking", async () => {
  const store = new RoundtableStore({ filePath: "" });
  const jazz = await store.addMemory({ text: "okra 喜欢爵士乐", namespace: "kimi" });
  const weather = await store.addMemory({ text: "明天可能下雨", namespace: "kimi" });
  await store.setMemoryEmbedding(jazz.id, { embedding: [1, 0], model: "test-model" });
  await store.setMemoryEmbedding(weather.id, { embedding: [0, 1], model: "test-model" });

  const matches = await store.listMemories({ namespace: "kimi", query: "她爱听 jazz", queryVector: [0.95, 0.05] });
  assert.equal(matches[0].id, jazz.id);
  assert.equal(matches[0].vectorStatus, "indexed");
  assert.equal(matches[0].embeddingModel, "test-model");
  assert.ok(matches[0].vectorScore > 0.9);
});
