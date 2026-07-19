import { RoundtableStore } from "../src/store.js";
import { DEFAULT_EMBEDDING_MODEL, LocalEmbeddingService } from "../src/embeddings.js";

const store = new RoundtableStore({ filePath: process.env.ROUNDTABLE_STATE_FILE || ".roundtable/state.json" });
const embeddings = new LocalEmbeddingService({
  model: process.env.MEMORY_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
  cacheDir: process.env.MEMORY_MODEL_CACHE || ".roundtable/models",
  remoteHost: process.env.HF_ENDPOINT,
});
const snapshot = await store.getSnapshot();
let indexed = 0;
let failed = 0;

for (const memory of snapshot.memories) {
  if (memory.vectorStatus === "indexed" && memory.embeddingModel === embeddings.model && memory.embedding?.length) continue;
  try {
    const embedding = await embeddings.embed(memory.text);
    await store.setMemoryEmbedding(memory.id, { embedding, model: embeddings.model });
    indexed += 1;
    console.log(`indexed ${memory.id} (${memory.namespace})`);
  } catch (error) {
    failed += 1;
    console.error(`failed ${memory.id}: ${error?.message || error}`);
  }
}

console.log(`Memory reindex complete: ${indexed} indexed, ${failed} failed, ${snapshot.memories.length} total.`);
if (failed) process.exitCode = 1;
