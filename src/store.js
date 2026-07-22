import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cosineSimilarity } from "./embeddings.js";
import { stripInternalTimeMetadata } from "./prompt-time.js";
import { MessageArchive } from "./message-archive.js";
import { normalizeQuote } from "./quote-context.js";

const MAX_MESSAGES = 400;
const MAX_MEMORIES = 1_000;
const MAX_SHORT_TERM_MEMORIES = 800;
const MAX_EVENT_MEMORIES = 500;
const MAX_MEMBER_ROUNDS = 160;
const MEMBER_MEMORY_IDS = ["g", "kimi", "glm", "k"];

export class RoundtableStore {
  constructor({ filePath = "", archiveFilePath } = {}) {
    this.filePath = filePath ? path.resolve(filePath) : "";
    const resolvedArchive = archiveFilePath === ":memory:" ? ":memory:"
      : archiveFilePath ? path.resolve(archiveFilePath)
        : this.filePath ? path.join(path.dirname(this.filePath), "chat-history.sqlite") : ":memory:";
    this.archive = new MessageArchive({ filePath: resolvedArchive });
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
    const normalized = normalizeMessage(message);
    if (!normalized) return null;
    const result = await this.mutate((state) => {
      if (!state.messages.some((item) => item.id === normalized.id)) state.messages.push(normalized);
      state.messages = state.messages.slice(-MAX_MESSAGES);
      state.updatedAt = new Date().toISOString();
      return normalized;
    });
    this.archive.upsert(result);
    return result;
  }

  async importMessages(messages) {
    const normalizedMessages = (Array.isArray(messages) ? messages : []).map(normalizeMessage).filter(Boolean);
    const result = await this.mutate((state) => {
      const knownIds = new Set(state.messages.map((item) => item.id));
      for (const message of normalizedMessages) {
        if (!knownIds.has(message.id)) {
          knownIds.add(message.id);
          state.messages.push(message);
        }
      }
      state.messages = state.messages.slice(-MAX_MESSAGES);
      state.updatedAt = new Date().toISOString();
      return clone(state.messages);
    });
    this.archive.import(normalizedMessages);
    return result;
  }

  async clearMessages(channel = "") {
    const result = await this.mutate((state) => {
      const normalizedChannel = clean(channel).slice(0, 40);
      state.messages = normalizedChannel
        ? state.messages.filter((message) => message.channel !== normalizedChannel)
        : [];
      state.updatedAt = new Date().toISOString();
      return [];
    });
    this.archive.clear(channel);
    return result;
  }

  async listArchivedMessages(options = {}) {
    await this.ensureLoaded();
    return clone(this.archive.list(options));
  }

  async searchArchivedMessages(options = {}) {
    await this.ensureLoaded();
    return clone(this.archive.search(options));
  }

  async getArchivedMessageContext(id, radius = 24) {
    await this.ensureLoaded();
    return clone(this.archive.around(id, radius));
  }

  close() {
    this.archive.close();
  }

  async setAvatar(id, url) {
    const avatarId = normalizeAvatarId(id);
    const avatarUrl = normalizeAvatarUrl(url);
    if (!avatarId || !avatarUrl) throw new Error("头像资料不正确");
    return this.mutate((state) => {
      const previous = state.avatars[avatarId] || "";
      state.avatars[avatarId] = avatarUrl;
      state.updatedAt = new Date().toISOString();
      return { id: avatarId, url: avatarUrl, previous };
    });
  }

  async deleteAvatar(id) {
    const avatarId = normalizeAvatarId(id);
    if (!avatarId) return null;
    return this.mutate((state) => {
      const previous = state.avatars[avatarId] || "";
      delete state.avatars[avatarId];
      state.updatedAt = new Date().toISOString();
      return previous ? { id: avatarId, previous } : null;
    });
  }

  async setProfileSignature(id, signature) {
    const profileId = normalizeAvatarId(id);
    if (!profileId) throw new Error("成员资料不正确");
    const normalizedSignature = normalizeProfileSignature(signature);
    return this.mutate((state) => {
      if (normalizedSignature) state.signatures[profileId] = normalizedSignature;
      else delete state.signatures[profileId];
      state.updatedAt = new Date().toISOString();
      return { id: profileId, signature: normalizedSignature };
    });
  }

  async setChatBackground(channel, url) {
    const chatChannel = normalizeChatChannel(channel);
    const backgroundUrl = normalizeAvatarUrl(url);
    if (!chatChannel || !backgroundUrl) throw new Error("聊天背景资料不正确");
    return this.mutate((state) => {
      const previous = state.chatBackgrounds[chatChannel] || "";
      state.chatBackgrounds[chatChannel] = backgroundUrl;
      state.updatedAt = new Date().toISOString();
      return { channel: chatChannel, url: backgroundUrl, previous };
    });
  }

  async deleteChatBackground(channel) {
    const chatChannel = normalizeChatChannel(channel);
    if (!chatChannel) return null;
    return this.mutate((state) => {
      const previous = state.chatBackgrounds[chatChannel] || "";
      delete state.chatBackgrounds[chatChannel];
      state.updatedAt = new Date().toISOString();
      return previous ? { channel: chatChannel, previous } : null;
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

  async listShortTermMemories({ query = "", namespace = "", limit = 50, queryVector = [], now = new Date().toISOString() } = {}) {
    await this.ensureLoaded();
    const current = Date.parse(clean(now)) || Date.now();
    return clone(rankContextMemories(
      this.state.shortTermMemories.filter((memory) => (
        (!namespace || memory.namespace === normalizeNamespace(namespace, ""))
        && Date.parse(memory.expiresAt) > current
      )),
      { query, queryVector, limit },
    ));
  }

  async addShortTermMemory(input = {}) {
    const candidate = normalizeShortTermMemory(input);
    if (!candidate) throw new Error("短期记忆内容不能为空");
    return this.mutate((state) => {
      const now = new Date().toISOString();
      state.shortTermMemories = state.shortTermMemories.filter((memory) => Date.parse(memory.expiresAt) > Date.now());
      const existing = state.shortTermMemories.find((memory) => (
        memory.namespace === candidate.namespace
        && (memory.fingerprint === candidate.fingerprint || memory.text.toLowerCase() === candidate.text.toLowerCase())
      ));
      if (existing) {
        existing.text = chooseRicherText(existing.text, candidate.text);
        existing.tier = strongerShortTier(existing.tier, candidate.tier);
        existing.importance = Math.max(existing.importance, candidate.importance);
        existing.expiresAt = laterIso(existing.expiresAt, candidate.expiresAt);
        existing.sourceRoundIds = uniqueStrings([...existing.sourceRoundIds, ...candidate.sourceRoundIds], 40);
        existing.embedding = candidate.embedding.length ? candidate.embedding : existing.embedding;
        existing.embeddingModel = candidate.embedding.length ? candidate.embeddingModel : existing.embeddingModel;
        existing.updatedAt = now;
        state.updatedAt = now;
        return clone(existing);
      }
      state.shortTermMemories.push(candidate);
      state.shortTermMemories = state.shortTermMemories.slice(-MAX_SHORT_TERM_MEMORIES);
      state.updatedAt = now;
      return clone(candidate);
    });
  }

  async deleteShortTermMemory(id) {
    const normalizedId = clean(id);
    return this.mutate((state) => {
      const before = state.shortTermMemories.length;
      state.shortTermMemories = state.shortTermMemories.filter((item) => item.id !== normalizedId);
      state.updatedAt = new Date().toISOString();
      return state.shortTermMemories.length !== before;
    });
  }

  async listEventMemories({ query = "", namespace = "", limit = 50, queryVector = [] } = {}) {
    await this.ensureLoaded();
    return clone(rankContextMemories(
      this.state.eventMemories.filter((memory) => !namespace || memory.namespace === normalizeNamespace(namespace, "")),
      { query, queryVector, limit },
    ));
  }

  async addEventMemory(input = {}) {
    const candidate = normalizeEventMemory(input);
    if (!candidate) throw new Error("事件记忆内容不能为空");
    return this.mutate((state) => {
      const now = new Date().toISOString();
      const existing = state.eventMemories.find((memory) => (
        memory.namespace === candidate.namespace
        && (memory.fingerprint === candidate.fingerprint || memory.text.toLowerCase() === candidate.text.toLowerCase())
      ));
      if (existing) {
        existing.text = chooseRicherText(existing.text, candidate.text);
        existing.participants = uniqueStrings([...existing.participants, ...candidate.participants], 10);
        existing.confirmedBy = uniqueStrings([...existing.confirmedBy, ...candidate.confirmedBy], 10);
        existing.sourceRoundIds = uniqueStrings([...existing.sourceRoundIds, ...candidate.sourceRoundIds], 40);
        existing.importance = Math.max(existing.importance, candidate.importance);
        existing.embedding = candidate.embedding.length ? candidate.embedding : existing.embedding;
        existing.embeddingModel = candidate.embedding.length ? candidate.embeddingModel : existing.embeddingModel;
        existing.updatedAt = now;
        state.updatedAt = now;
        return clone(existing);
      }
      state.eventMemories.push(candidate);
      state.eventMemories = state.eventMemories.slice(-MAX_EVENT_MEMORIES);
      state.updatedAt = now;
      return clone(candidate);
    });
  }

  async addMemberRound(memberId, input = {}) {
    const member = normalizeMemberMemoryId(memberId);
    const candidate = normalizeMemberRound({ ...input, memberId: member });
    if (!member || !candidate) return null;
    return this.mutate((state) => {
      const rounds = state.memberRounds[member] || [];
      const existing = rounds.find((round) => round.key === candidate.key);
      if (existing) return clone(existing);
      const nextSequence = Math.max(0, ...rounds.map((round) => round.sequence || 0)) + 1;
      const round = { ...candidate, sequence: nextSequence };
      state.memberRounds[member] = [...rounds, round].slice(-MAX_MEMBER_ROUNDS);
      state.updatedAt = new Date().toISOString();
      return clone(round);
    });
  }

  async listMemberRounds(memberId, { limit = 30 } = {}) {
    await this.ensureLoaded();
    const member = normalizeMemberMemoryId(memberId);
    const capped = positiveInt(limit, 30, 1, MAX_MEMBER_ROUNDS);
    return clone((this.state.memberRounds[member] || []).slice(-capped));
  }

  async getPendingMemberReview(memberId, batchSize = 30) {
    await this.ensureLoaded();
    const member = normalizeMemberMemoryId(memberId);
    const cursor = Number(this.state.memoryReviewCursors[member]) || 0;
    const pending = (this.state.memberRounds[member] || []).filter((round) => round.sequence > cursor);
    const size = positiveInt(batchSize, 30, 2, 60);
    return pending.length >= size ? clone(pending.slice(0, size)) : [];
  }

  async completeMemberReview(memberId, endSequence) {
    const member = normalizeMemberMemoryId(memberId);
    const sequence = positiveInt(endSequence, 0, 0, Number.MAX_SAFE_INTEGER);
    if (!member || !sequence) return false;
    return this.mutate((state) => {
      state.memoryReviewCursors[member] = Math.max(Number(state.memoryReviewCursors[member]) || 0, sequence);
      state.updatedAt = new Date().toISOString();
      return true;
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
    this.archive.initialize();
    this.archive.import(this.state.messages);
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
  return {
    version: 7,
    messages: [],
    memories: [],
    shortTermMemories: [],
    eventMemories: [],
    memberRounds: emptyMemberRounds(),
    memoryReviewCursors: {},
    avatars: {},
    signatures: {},
    chatBackgrounds: {},
    updatedAt: "",
  };
}

function normalizeState(value) {
  return {
    version: 7,
    messages: (Array.isArray(value?.messages) ? value.messages : []).map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES),
    memories: (Array.isArray(value?.memories) ? value.memories : []).map(normalizeMemory).filter(Boolean).slice(-MAX_MEMORIES),
    shortTermMemories: (Array.isArray(value?.shortTermMemories) ? value.shortTermMemories : [])
      .map(normalizeShortTermMemory).filter(Boolean).filter((memory) => Date.parse(memory.expiresAt) > Date.now()).slice(-MAX_SHORT_TERM_MEMORIES),
    eventMemories: (Array.isArray(value?.eventMemories) ? value.eventMemories : [])
      .map(normalizeEventMemory).filter(Boolean).slice(-MAX_EVENT_MEMORIES),
    memberRounds: normalizeMemberRounds(value?.memberRounds),
    memoryReviewCursors: normalizeMemoryReviewCursors(value?.memoryReviewCursors),
    avatars: normalizeAvatars(value?.avatars),
    signatures: normalizeSignatures(value?.signatures),
    chatBackgrounds: normalizeChatBackgrounds(value?.chatBackgrounds),
    updatedAt: clean(value?.updatedAt),
  };
}

function emptyMemberRounds() {
  return Object.fromEntries(MEMBER_MEMORY_IDS.map((id) => [id, []]));
}

function normalizeMemberRounds(value) {
  const output = emptyMemberRounds();
  for (const member of MEMBER_MEMORY_IDS) {
    output[member] = (Array.isArray(value?.[member]) ? value[member] : [])
      .map((round) => normalizeMemberRound({ ...round, memberId: member }))
      .filter(Boolean)
      .sort((left, right) => left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt))
      .slice(-MAX_MEMBER_ROUNDS);
  }
  return output;
}

function normalizeMemoryReviewCursors(value) {
  return Object.fromEntries(MEMBER_MEMORY_IDS.map((id) => [id, positiveInt(value?.[id], 0, 0, Number.MAX_SAFE_INTEGER)]));
}

function normalizeSignatures(value) {
  const signatures = {};
  for (const id of ["okra", "gen", "kimi", "glm", "k"]) {
    const signature = normalizeProfileSignature(value?.[id]);
    if (signature) signatures[id] = signature;
  }
  return signatures;
}

function normalizeProfileSignature(value) {
  return [...clean(value).replace(/\s+/gu, " ")].slice(0, 15).join("");
}

function normalizeAvatars(value) {
  const avatars = {};
  for (const id of ["okra", "gen", "kimi", "glm", "k"]) {
    const url = normalizeAvatarUrl(value?.[id]);
    if (url) avatars[id] = url;
  }
  return avatars;
}

function normalizeAvatarId(value) {
  const id = clean(value).toLowerCase();
  return ["okra", "gen", "kimi", "glm", "k"].includes(id) ? id : "";
}

function normalizeChatBackgrounds(value) {
  const backgrounds = {};
  for (const channel of ["group", "gen", "kimi", "glm"]) {
    const url = normalizeAvatarUrl(value?.[channel]);
    if (url) backgrounds[channel] = url;
  }
  return backgrounds;
}

function normalizeChatChannel(value) {
  const channel = clean(value).toLowerCase();
  return ["group", "gen", "kimi", "glm"].includes(channel) ? channel : "";
}

function normalizeAvatarUrl(value) {
  const url = clean(value).slice(0, 500);
  return /^\/uploads\/[A-Za-z0-9-]+\.(?:png|jpe?g|webp|gif)$/u.test(url) ? url : "";
}

function normalizeMessage(value) {
  const rawContent = clean(value?.content);
  const content = clean(value?.role === "assistant" && clean(value?.providerId) === "kimi"
    ? stripInternalTimeMetadata(rawContent)
    : rawContent);
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
    mode: ["work", "guide"].includes(value?.mode) ? value.mode : "chat",
    workspaceId: clean(value?.workspaceId).slice(0, 80),
    workspaceLabel: clean(value?.workspaceLabel).slice(0, 120),
    proactive: value?.proactive === true,
    toolCalls: normalizeToolCalls(value?.toolCalls),
    reasoning: clean(value?.reasoning).slice(0, 60_000),
    readAt: clean(value?.readAt),
    replyToId: clean(value?.replyToId),
    triggeredBy: clean(value?.triggeredBy).slice(0, 80),
    quote: normalizeQuote(value?.quote),
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

function normalizeShortTermMemory(value) {
  const text = clean(value?.text).replace(/\s+/gu, " ").slice(0, 800);
  if (!text) return null;
  const now = clean(value?.createdAt) || new Date().toISOString();
  const tier = normalizeShortTier(value?.tier);
  const defaultDays = tier === "hot" ? 3 : tier === "active" ? 14 : 30;
  const expiresAt = validFutureIso(value?.expiresAt, now, defaultDays);
  const namespace = normalizeNamespace(value?.namespace);
  return {
    id: clean(value?.id) || makeId(),
    text,
    namespace,
    tier,
    importance: normalizeImportance(value?.importance),
    fingerprint: clean(value?.fingerprint).slice(0, 200) || contextFingerprint(namespace, text),
    sourceRoundIds: uniqueStrings(value?.sourceRoundIds, 40),
    embedding: normalizeEmbedding(value?.embedding),
    embeddingModel: clean(value?.embeddingModel).slice(0, 200),
    vectorStatus: normalizeVectorStatus(value),
    createdAt: now,
    updatedAt: clean(value?.updatedAt) || now,
    expiresAt,
  };
}

function normalizeEventMemory(value) {
  const text = clean(value?.text || value?.event).replace(/\s+/gu, " ").slice(0, 800);
  if (!text) return null;
  const now = clean(value?.createdAt) || new Date().toISOString();
  const namespace = normalizeNamespace(value?.namespace);
  const date = clean(value?.date).slice(0, 32) || now.slice(0, 10);
  const participants = uniqueStrings(value?.participants, 10);
  return {
    id: clean(value?.id) || makeId(),
    text,
    namespace,
    date,
    participants,
    importance: normalizeImportance(value?.importance),
    fingerprint: clean(value?.fingerprint).slice(0, 200) || contextFingerprint(namespace, `${date}:${participants.join(",")}:${text}`),
    confirmedBy: uniqueStrings(value?.confirmedBy, 10),
    sourceRoundIds: uniqueStrings(value?.sourceRoundIds, 40),
    embedding: normalizeEmbedding(value?.embedding),
    embeddingModel: clean(value?.embeddingModel).slice(0, 200),
    vectorStatus: normalizeVectorStatus(value),
    createdAt: now,
    updatedAt: clean(value?.updatedAt) || now,
  };
}

function normalizeMemberRound(value) {
  const memberId = normalizeMemberMemoryId(value?.memberId);
  const triggerText = clean(value?.triggerText).slice(0, 4_000);
  const responseText = clean(value?.responseText).slice(0, 4_000);
  if (!memberId || (!triggerText && !responseText)) return null;
  const createdAt = clean(value?.createdAt) || new Date().toISOString();
  const key = clean(value?.key).slice(0, 240)
    || `${memberId}:${clean(value?.triggerMessageId) || createdAt}:${clean(value?.responseMessageId) || (value?.skipped ? "skip" : "reply")}`;
  return {
    id: clean(value?.id) || makeId(),
    key,
    sequence: positiveInt(value?.sequence, 0, 0, Number.MAX_SAFE_INTEGER),
    memberId,
    scene: value?.scene === "group" ? "group" : "private",
    triggerMessageId: clean(value?.triggerMessageId).slice(0, 120),
    triggerAuthor: clean(value?.triggerAuthor).slice(0, 80) || "Okra",
    triggerText,
    responseMessageId: clean(value?.responseMessageId).slice(0, 120),
    responseText,
    skipped: value?.skipped === true,
    createdAt,
  };
}

function rankContextMemories(memories, { query = "", queryVector = [], limit = 50 } = {}) {
  const normalizedQuery = clean(query).toLowerCase();
  const hasVector = Array.isArray(queryVector) && queryVector.length > 0;
  const capped = positiveInt(limit, 50, 1, 200);
  return memories.map((memory) => {
    const lexical = normalizedQuery ? lexicalScore(memory, normalizedQuery) : 0;
    const vectorScore = hasVector ? cosineSimilarity(memory.embedding, queryVector) : 0;
    const ageDays = Math.max(0, (Date.now() - Date.parse(memory.updatedAt || memory.createdAt || 0)) / 86_400_000) || 0;
    const recency = memory.expiresAt ? 1 / (1 + ageDays / 3) : 0.25 / (1 + ageDays / 180);
    return {
      memory,
      score: (vectorScore * 8) + (Math.min(lexical, 20) * 0.35) + (memory.importance * 0.05) + recency,
      vectorScore,
    };
  }).filter((item) => !normalizedQuery && !hasVector
    ? true
    : item.score > 0 && (!hasVector || item.vectorScore >= 0.28 || item.score > 1.5))
    .sort((left, right) => right.score - left.score || right.memory.updatedAt.localeCompare(left.memory.updatedAt))
    .slice(0, capped)
    .map(({ memory, score, vectorScore }) => ({ ...memory, score, vectorScore }));
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
  const labels = [
    ...(Array.isArray(memory.tags) ? memory.tags : []),
    ...(Array.isArray(memory.participants) ? memory.participants : []),
  ];
  const text = `${memory.text} ${labels.join(" ")} ${memory.namespace}`.toLowerCase();
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

function normalizeMemberMemoryId(value) {
  const id = clean(value).toLowerCase();
  if (["gen", "openai", "codex-cli", "gpt"].includes(id)) return "g";
  if (["shin", "glm"].includes(id)) return "glm";
  if (["anthropic", "claude-code"].includes(id)) return "k";
  return MEMBER_MEMORY_IDS.includes(id) ? id : "";
}

function normalizeShortTier(value) {
  const tier = clean(value).toLowerCase();
  return ["hot", "active", "fading"].includes(tier) ? tier : "active";
}

function validFutureIso(value, createdAt, days) {
  const created = Date.parse(createdAt) || Date.now();
  const parsed = Date.parse(clean(value));
  const target = Number.isFinite(parsed) && parsed > created ? parsed : created + days * 86_400_000;
  return new Date(target).toISOString();
}

function contextFingerprint(namespace, text) {
  return `${namespace}:${clean(text).toLowerCase().replace(/[\s，。！？、,.!?;；:："“”'‘’（）()\[\]]+/gu, "")}`.slice(0, 200);
}

function chooseRicherText(left, right) {
  const a = clean(left);
  const b = clean(right);
  return [...b].length > [...a].length ? b : a;
}

function strongerShortTier(left, right) {
  const rank = { hot: 1, active: 2, fading: 3 };
  return rank[normalizeShortTier(right)] > rank[normalizeShortTier(left)] ? normalizeShortTier(right) : normalizeShortTier(left);
}

function laterIso(left, right) {
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function uniqueStrings(value, limit) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => clean(item).slice(0, 120)).filter(Boolean))].slice(0, limit);
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
