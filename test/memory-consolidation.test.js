import test from "node:test";
import assert from "node:assert/strict";
import { RoundtableStore } from "../src/store.js";
import {
  applyMemoryReviewDecision,
  parseMemoryReviewDecision,
  reviewMemberMemoryBatch,
} from "../src/memory-consolidation.js";
import { retrievePromptMemories } from "../src/memory-retrieval.js";

function rounds(count = 30, scene = "group") {
  return Array.from({ length: count }, (_, index) => ({
    id: `round-${index + 1}`,
    key: `key-${index + 1}`,
    sequence: index + 1,
    memberId: "glm",
    scene,
    triggerMessageId: `u-${index + 1}`,
    triggerAuthor: "Okra",
    triggerText: index === 0 ? "我最近开始准备搬家，这件事大家都可以知道" : `普通对话 ${index + 1}`,
    responseMessageId: `a-${index + 1}`,
    responseText: `回应 ${index + 1}`,
    skipped: false,
    createdAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
  }));
}

test("member rounds create one non-overlapping review checkpoint every 30 decisions", async () => {
  const store = new RoundtableStore({ filePath: "", archiveFilePath: ":memory:" });
  for (const round of rounds(60)) await store.addMemberRound("glm", round);
  assert.deepEqual((await store.getPendingMemberReview("glm", 30)).map((item) => item.sequence), Array.from({ length: 30 }, (_, i) => i + 1));
  await store.completeMemberReview("glm", 30);
  assert.deepEqual((await store.getPendingMemberReview("glm", 30)).map((item) => item.sequence), Array.from({ length: 30 }, (_, i) => i + 31));
  store.close();
});

test("private evidence cannot enter shared memory while public evidence can", async () => {
  const store = new RoundtableStore({ filePath: "", archiveFilePath: ":memory:" });
  const privateRounds = rounds(30, "private");
  privateRounds[0].triggerText = "我最近开始准备搬家";
  const privateDecision = parseMemoryReviewDecision(JSON.stringify({
    shared: [{ text: "Okra 要搬家", importance: 4, evidence_round_ids: ["round-1"] }],
  }), privateRounds);
  await applyMemoryReviewDecision({ memberId: "glm", decision: privateDecision, rounds: privateRounds, store });
  assert.equal((await store.listMemories({ namespace: "shared" })).length, 0);

  const publicRounds = rounds(30, "group");
  const publicDecision = parseMemoryReviewDecision(JSON.stringify({
    shared: [{ text: "Okra 最近在准备搬家", importance: 4, evidence_round_ids: ["round-1"] }],
  }), publicRounds);
  await applyMemoryReviewDecision({ memberId: "glm", decision: publicDecision, rounds: publicRounds, store });
  assert.equal((await store.listMemories({ namespace: "shared" })).length, 1);
  store.close();
});

test("duplicate shared proposals merge into one canonical memory", async () => {
  const store = new RoundtableStore({ filePath: "", archiveFilePath: ":memory:" });
  const batch = rounds();
  for (const memberId of ["glm", "kimi"]) {
    const decision = parseMemoryReviewDecision(JSON.stringify({
      shared: [{ text: "Okra 最近在准备搬家", importance: 4, evidence_round_ids: ["round-1"] }],
    }), batch);
    await applyMemoryReviewDecision({ memberId, decision, rounds: batch, store });
  }
  const memories = await store.listMemories({ namespace: "shared" });
  assert.equal(memories.length, 1);
  assert.match(memories[0].metadata.confirmedBy, /Shin/u);
  assert.match(memories[0].metadata.confirmedBy, /Kimi/u);
  store.close();
});

test("short memories expire naturally and mixed retrieval returns current layers", async () => {
  const store = new RoundtableStore({ filePath: "", archiveFilePath: ":memory:" });
  await store.addMemory({ text: "Okra 喜欢日音", namespace: "glm", importance: 4 });
  await store.addShortTermMemory({
    text: "Okra 这周正在准备搬家", namespace: "glm", tier: "hot",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await store.addShortTermMemory({
    text: "已经过期的临时安排", namespace: "glm", tier: "hot",
    createdAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-02T00:00:00.000Z",
  });
  await store.addEventMemory({ text: "Okra 决定搬家", namespace: "glm", date: "2026-07-01", participants: ["Okra", "Shin"] });
  const result = await retrievePromptMemories({ store, query: "搬家", namespaces: ["glm"], limit: 8 });
  assert.equal(result.some((item) => item.memoryKind === "short_term" && item.text.includes("这周")), true);
  assert.equal(result.some((item) => item.memoryKind === "event"), true);
  assert.equal(result.some((item) => item.text.includes("已经过期")), false);
  store.close();
});

test("a valid 30-round review advances the cursor only after applying memory actions", async () => {
  const store = new RoundtableStore({ filePath: "", archiveFilePath: ":memory:" });
  const batch = rounds();
  for (const round of batch) await store.addMemberRound("glm", round);
  const provider = {
    id: "glm", available: true,
    async generate() {
      return JSON.stringify({
        long_term: [{ text: "Okra 喜欢日音", importance: 4 }],
        short_term: [{ text: "Okra 近期正在准备搬家", tier: "active", importance: 4 }],
        shared: [], events: [],
      });
    },
  };
  const result = await reviewMemberMemoryBatch({ provider, memberId: "glm", rounds: await store.getPendingMemberReview("glm"), store });
  assert.equal(result.status, "done");
  assert.equal((await store.getPendingMemberReview("glm")).length, 0);
  assert.equal((await store.listMemories({ namespace: "glm" })).length, 1);
  assert.equal((await store.listShortTermMemories({ namespace: "glm" })).length, 1);
  store.close();
});
