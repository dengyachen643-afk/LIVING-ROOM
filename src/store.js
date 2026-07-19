import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cosineSimilarity } from "./embeddings.js";

const MAX_MESSAGES = 400;
const MAX_MEMORIES = 1_000;

export class RoundtableStore {
  constructor({ filePath = "" } = {}) {
    this.filePath = filePath ? path.resolve(filePath) : "";
    this.state = emptyState();
    this.loaded = false;
    this.loadPromise = null;
    this.writeQueue = Promise.resolve();
  }

  async getSnapshot() {
    await this.ensureLoaded();
    return clone(this.state);
  }

  async addMessage(message) {
    return this.mutate((state) => {
      const normalized = normalizeMessage(message);
      if (!normalized) return null;
      if (!state.messages.some((item) => item.id === normalized.id)) state.messages.push(normalized);
      state.messages = state.messages.slice(-MAX_MESSAGES);
      state.updatedAt = new Date().toISOString();
      return normalized;
    });
  }

  async importMessages(messages) {
    return this.mutate((state) => {
      const knownIds = new Set(state.messages.map((item) => item.id));
      for (const candidate of Array.isArray(messages) ? messages : []) {
        const message = normalizeMessage(candidate);
        if (message && !knownIds.has(message.id)) {
          knownIds.add(message.id);
          state.messages.push(message);
        }
      }
      state.messages = state.messages.slice(-MAX_MESSAGES);
      state.updatedAt = new Date().toISOString();
      return clone(state.messages);
    });
  }

  async clearMessages(channel = "") {
    return this.mutate((state) => {
      const normalizedChannel = clean(channel).slice(0, 40);
      state.messages = normalizedChannel
        ? state.messages.filter((message) => message.channel !== normalizedChannel)
        : [];
      state.updatedAt = new Date().toISOString();
      return [];
    });
  }

  async listMemories({ query = "", namespace = "", limit = 50, queryVector = [] } = {}) {
    await this.ensureLoaded();
    const normalizedQuery = clean(query).toLowerCase();
    const normalizedNamespace = normalizeNamespace(namespace, "");
    const cappedLimit = positiveInt(limit, 50, 1, 200);
    const candidates = this.state.memories.filter((memory) => {
      if (normalizedNamespace && memory.namespace !== normalizedNamespace) return false;
      return true;
    });
    const hasVector = Array.isArray(queryVector) && queryVector.length > 0;
    const ranked = normalizedQuery || hasVector
      ? candidates
          .map((memory) => {
            const lexical = normalizedQuery ? lexicalScore(memory, normalizedQuery) : 0;
            const vectorScore = hasVector ? cosineSimilarity(memory.embedding, queryVector) : 0;
            return {
              memory,
              vectorScore,
              score: hasVector
                ? (vectorScore * 8) + (Math.min(lexical, 20) * 0.35) + (memory.importance * 0.05)
                : lexical,
            };
          })
          .filter((item) => item.score > 0 && (!hasVector || item.vectorScore >= 0.28 || item.score > 1.5))
          .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt))
          .map(({ memory, score, vectorScore }) => ({ ...memory, score, vectorScore }))
      : candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return clone(ranked.slice(0, cappedLimit));
  }

  async addMemory(input) {
    const candidate = typeof input === "string" ? { text: input } : input;
    const content = clean(candidate?.text).slice(0, 4_000);
    if (!content) throw new Error("记忆内容不能为空");
    return this.mutate((state) => {
      const now = new Date().toISOString();
      const namespace = normalizeNamespace(candidate?.namespace);
      const existing = state.memories.find((item) => (
        item.namespace === namespace && item.text.toLowerCase() === content.toLowerCase()
      ));
      if (existing) {
        existing.tags = normalizeTags(candidate?.tags?.length ? candidate.tags : existing.tags);
        existing.importance = normalizeImportance(candidate?.importance ?? existing.importance);
        existing.source = clean(candidate?.source).slice(0, 80) || existing.source;
        existing.metadata = normalizeMetadata(candidate?.metadata ?? existing.metadata);
        if (Array.isArray(candidate?.embedding) && candidate.embedding.length) {
          existing.embedding = normalizeEmbedding(candidate.embedding);
          existing.embeddingModel = clean(candidate.embeddingModel).slice(0, 200);
          existing.vectorStatus = existing.embedding.length ? "indexed" : "not_indexed";
        }
        existing.updatedAt = now;
        return clone(existing);
      }
      const memory = normalizeMemory({ ...candidate, text: content, namespace, createdAt: now, updatedAt: now });
      state.memories.push(memory);
      state.memories = state.memories.slice(-MAX_MEMORIES);
      state.updatedAt = now;
      return clone(memory);
    });
  }

  async updateMemory(id, updates = {}) {
    const normalizedId = clean(id);
    return this.mutate((state) => {
      const memory = state.memories.find((item) => item.id === normalizedId);
      if (!memory) return null;
      const nextText = updates.text === undefined ? memory.text : clean(updates.text).slice(0, 4_000);
      if (!nextText) throw new Error("记忆内容不能为空");
      const textChanged = nextText !== memory.text;
      memory.text = nextText;
      if (updates.namespace !== undefined) memory.namespace = normalizeNamespace(updates.namespace);
      if (updates.tags !== undefined) memory.tags = normalizeTags(updates.tags);
      if (updates.importance !== undefined) memory.importance = normalizeImportance(updates.importance);
      if (updates.source !== undefined) memory.source = clean(updates.source).slice(0, 80) || memory.source;
      if (updates.metadata !== undefined) memory.metadata = normalizeMetadata(updates.metadata);
      if (textChanged) {
        memory.embedding = [];
        memory.embeddingModel = "";
        memory.vectorStatus = "not_indexed";
      }
      memory.updatedAt = new Date().toISOString();
      state.updatedAt = memory.updatedAt;
      return clone(memory);
    });
  }

  async setMemoryEmbedding(id, { embedding = [], model = "" } = {}) {
    const normalizedId = clean(id);
    return this.mutate((state) => {
      const memory = state.memories.find((item) => item.id === normalizedId);
      if (!memory) return null;
      memory.embedding = normalizeEmbedding(embedding);
      memory.embeddingModel = clean(model).slice(0, 200);
      memory.vectorStatus = memory.embedding.length ? "indexed" : "not_indexed";
      memory.updatedAt = new Date().toISOString();
      state.updatedAt = memory.updatedAt;
      return clone(memory);
    });
  }

  async deleteMemory(id) {
    const normalizedId = clean(id);
    return this.mutate((state) => {
      const before = state.memories.length;
      state.memories = state.memories.filter((item) => item.id !== normalizedId);
      state.updatedAt = new Date().toISOString();
      return state.memories.length !== before;
    });
  }

  async ensureLoaded() {
    if (this.loaded) return;
    if (!this.loadPromise) this.loadPromise = this.load();
    await this.loadPromise;
  }

  async load() {
    if (!this.filePath) {
      this.loaded = true;
      return;
    }
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      this.state = normalizeState(parsed);
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error(`无法读取圆桌记忆文件：${error.message}`);
    }
    this.loaded = true;
  }

  mutate(mutator) {
    const operation = this.writeQueue.then(async () => {
      await this.ensureLoaded();
      const result = mutator(this.state);
      await this.save();
      return result;
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async save() {
    if (!this.filePath) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }
}

function emptyState() {
  return { version: 3, messages: [], memories: [], updatedAt: "" };
}

function normalizeState(value) {
  return {
    version: 3,
    messages: (Array.isArray(value?.messages) ? value.messages : []).map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES),
    memories: (Array.isArray(value?.memories) ? value.memories : []).map(normalizeMemory).filter(Boolean).slice(-MAX_MEMORIES),
    updatedAt: clean(value?.updatedAt),
  };
}

function normalizeMessage(value) {
  const content = clean(value?.content).slice(0, 12_000);
  const attachments = normalizeAttachments(value?.attachments);
  if (!content && !attachments.length) return null;
  return {
    id: clean(value?.id) || makeId(),
    role: value?.role === "assistant" ? "assistant" : "user",
    providerId: clean(value?.providerId),
    author: clean(value?.author) || (value?.role === "assistant" ? "AI" : "用户"),
    channel: clean(value?.channel).slice(0, 40) || "group",
    model: clean(value?.model),
    content,
    attachments,
    toolCalls: normalizeToolCalls(value?.toolCalls),
    reasoning: clean(value?.reasoning).slice(0, 60_000),
    readAt: clean(value?.readAt),
    replyToId: clean(value?.replyToId),
    triggeredBy: clean(value?.triggeredBy).slice(0, 80),
    mentions: [...new Set((Array.isArray(value?.mentions) ? value.mentions : []).map(clean).filter(Boolean))].slice(0, 10),
    createdAt: clean(value?.createdAt) || new Date().toISOString(),
  };
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).map((item) => ({
    type: item?.type === "image" ? "image" : "",
    name: clean(item?.name).slice(0, 180),
    mimeType: clean(item?.mimeType).slice(0, 80),
    size: positiveInt(item?.size, 0, 0, 10_000_000),
    url: clean(item?.url).slice(0, 500),
  })).filter((item) => item.type === "image" && item.url.startsWith("/uploads/"));
}

function normalizeToolCalls(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => ({
    name: clean(item?.name).slice(0, 100),
    label: clean(item?.label).slice(0, 160),
    status: item?.status === "failed" ? "failed" : "done",
  })).filter((item) => item.name);
}

function normalizeMemory(value) {
  const text = clean(value?.text).slice(0, 4_000);
  if (!text) return null;
  const now = new Date().toISOString();
  return {
    id: clean(value?.id) || makeId(),
    text,
    namespace: normalizeNamespace(value?.namespace),
    tags: normalizeTags(value?.tags),
    importance: normalizeImportance(value?.importance),
    source: clean(value?.source).slice(0, 80) || "user",
    metadata: normalizeMetadata(value?.metadata),
    embedding: normalizeEmbedding(value?.embedding),
    embeddingModel: clean(value?.embeddingModel).slice(0, 200),
    vectorStatus: normalizeVectorStatus(value),
    createdAt: clean(value?.createdAt) || now,
    updatedAt: clean(value?.updatedAt) || now,
  };
}

function normalizeEmbedding(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2_048).map(Number).filter(Number.isFinite);
}

function normalizeVectorStatus(value) {
  if (Array.isArray(value?.embedding) && value.embedding.length) return "indexed";
  return value?.vectorStatus === "pending" ? "pending" : "not_indexed";
}

function lexicalScore(memory, query) {
  const terms = query.split(/\s+/).filter(Boolean);
  const text = `${memory.text} ${memory.tags.join(" ")} ${memory.namespace}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += term.length + 1;
    if (memory.text.toLowerCase().includes(term)) score += 2;
  }
  return score + (score ? memory.importance / 10 : 0);
}

function normalizeNamespace(value, fallback = "shared") {
  const normalized = clean(value).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return normalized || fallback;
}

function normalizeTags(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => clean(item).toLowerCase().slice(0, 40))
    .filter(Boolean))].slice(0, 20);
}

function normalizeImportance(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(1, parsed)) : 3;
}

function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value).slice(0, 20).map(([key, item]) => [
    clean(key).slice(0, 60),
    ["string", "number", "boolean"].includes(typeof item) ? item : JSON.stringify(item).slice(0, 500),
  ]).filter(([key]) => key);
  return Object.fromEntries(entries);
}

function positiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
