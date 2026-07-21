import test from "node:test";
import assert from "node:assert/strict";
import { retrievePromptMemories } from "../src/memory-retrieval.js";

test("prompt memory retrieval scopes, reranks, deduplicates and respects its budget", async () => {
  const memories = [
    { id: "g1", namespace: "g", text: `示例用户喜欢海边灯塔展览${"。".repeat(70)}`, score: 3, importance: 5, updatedAt: "2026-07-20T00:00:00.000Z", embedding: [1, 0] },
    { id: "g2", namespace: "g", text: `示例用户喜欢海边灯塔展览${"。".repeat(70)}`, score: 2.9, importance: 4, updatedAt: "2026-07-19T00:00:00.000Z", embedding: [1, 0] },
    { id: "shared1", namespace: "shared", text: `海边灯塔展览是近期的重要事件${"。".repeat(70)}`, score: 2, importance: 4, updatedAt: "2026-07-18T00:00:00.000Z", embedding: [0.8, 0.2] },
    { id: "kimi1", namespace: "kimi", text: "这条属于 Kimi，不能给 Gen", score: 9, importance: 5, updatedAt: "2026-07-21T00:00:00.000Z", embedding: [1, 0] },
  ];
  const store = {
    async listMemories({ namespace }) {
      return memories.filter((memory) => memory.namespace === namespace);
    },
  };

  const result = await retrievePromptMemories({
    store,
    query: "海边灯塔展览",
    namespaces: ["g", "shared"],
    limit: 5,
    charBudget: 200,
  });

  assert.deepEqual(result.map((memory) => memory.id), ["g1", "shared1"]);
  assert.equal(result.some((memory) => memory.namespace === "kimi"), false);
  assert.ok(result.reduce((total, memory) => total + [...memory.text].length, 0) <= 200);
});
