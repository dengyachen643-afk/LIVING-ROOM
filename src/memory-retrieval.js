import { cosineSimilarity } from "./embeddings.js";
import { isLowQualityAutoMemory } from "./memory-quality.js";

const DEFAULT_CANDIDATE_LIMIT = 20;
const DEFAULT_RESULT_LIMIT = 6;
const DEFAULT_CHAR_BUDGET = 1_200;
const MAX_MEMORY_CHARS = 600;

export async function retrievePromptMemories({
  store,
  embeddings = null,
  query = "",
  namespaces = [],
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
  limit = DEFAULT_RESULT_LIMIT,
  charBudget = DEFAULT_CHAR_BUDGET,
  excludeSourceRoundIds = [],
} = {}) {
  if (!store) return [];
  const text = clean(query).slice(0, 4_000);
  const queryVector = await embedSafe(embeddings, text);
  const scope = unique((Array.isArray(namespaces) ? namespaces : [namespaces]).map(clean).filter(Boolean));
  const perNamespaceLimit = clampInt(candidateLimit, 4, 50, DEFAULT_CANDIDATE_LIMIT);
  const longGroups = await Promise.all(scope.map(async (namespace) => {
    const matches = await store.listMemories({ query: text, namespace, limit: perNamespaceLimit, queryVector });
    return matches.length ? matches : store.listMemories({ namespace, limit: Math.min(4, perNamespaceLimit) });
  }));
  const shortGroups = typeof store.listShortTermMemories === "function"
    ? await Promise.all(scope.map((namespace) => store.listShortTermMemories({ query: text, namespace, limit: perNamespaceLimit, queryVector })))
    : [];
  const eventGroups = typeof store.listEventMemories === "function"
    ? await Promise.all(scope.map((namespace) => store.listEventMemories({ query: text, namespace, limit: perNamespaceLimit, queryVector })))
    : [];
  const excludedRounds = new Set((Array.isArray(excludeSourceRoundIds) ? excludeSourceRoundIds : []).map(clean).filter(Boolean));
  const allCandidates = [
    ...longGroups.flat().map((memory) => ({ ...memory, memoryKind: "long_term" })),
    ...shortGroups.flat().map((memory) => ({ ...memory, memoryKind: "short_term" })),
    ...eventGroups.flat().map((memory) => ({ ...memory, memoryKind: "event" })),
  ].filter((memory) => !memorySourceRoundIds(memory).some((id) => excludedRounds.has(id)));
  const candidates = uniqueById(allCandidates).map((memory) => ({
    ...memory,
    retrievalScore: rerankScore(memory, text),
  })).sort((left, right) => right.retrievalScore - left.retrievalScore || newerFirst(left, right));

  const selected = [];
  const normalizedTexts = new Set();
  const resultLimit = clampInt(limit, 1, 12, DEFAULT_RESULT_LIMIT);
  const categoryLimits = {
    short_term: Math.min(3, Math.max(1, Math.ceil(resultLimit / 2))),
    event: Math.min(2, Math.max(1, Math.floor(resultLimit / 3))),
  };
  const categoryCounts = { long_term: 0, short_term: 0, event: 0 };
  let remainingChars = clampInt(charBudget, 200, 4_000, DEFAULT_CHAR_BUDGET);
  for (const candidate of candidates) {
    if (selected.length >= resultLimit || remainingChars <= 0) break;
    if (isLowQualityAutoMemory(candidate)) continue;
    const kind = candidate.memoryKind || "long_term";
    if (categoryLimits[kind] && categoryCounts[kind] >= categoryLimits[kind]) continue;
    const normalized = normalizeText(candidate.text);
    if (!normalized || normalizedTexts.has(normalized)) continue;
    if (selected.some((memory) => nearDuplicate(memory, candidate))) continue;
    const clippedText = [...clean(candidate.text)].slice(0, Math.min(MAX_MEMORY_CHARS, remainingChars)).join("");
    if (!clippedText) continue;
    selected.push({ ...candidate, text: clippedText });
    categoryCounts[kind] = (categoryCounts[kind] || 0) + 1;
    normalizedTexts.add(normalized);
    remainingChars -= [...clippedText].length;
  }
  return selected;
}

function rerankScore(memory, query) {
  const source = clean(memory?.text).toLowerCase();
  const target = clean(query).toLowerCase();
  const base = Number(memory?.score) || 0;
  const phraseBoost = target.length >= 2 && source.includes(target) ? 1.25 : 0;
  const termBoost = queryTerms(target).reduce((score, term) => score + (source.includes(term) ? Math.min(0.5, term.length * 0.08) : 0), 0);
  const importanceBoost = (Number(memory?.importance) || 3) * 0.04;
  const ageDays = Math.max(0, (Date.now() - Date.parse(memory?.updatedAt || 0)) / 86_400_000) || 0;
  const kind = memory?.memoryKind || "long_term";
  const recencyBoost = kind === "short_term"
    ? 0.55 / (1 + ageDays / 3)
    : kind === "event"
      ? 0.18 / (1 + ageDays / 180)
      : 0.12 / (1 + ageDays / 90);
  const kindBoost = kind === "short_term" ? 0.08 : kind === "event" ? 0.04 : 0;
  return base + phraseBoost + termBoost + importanceBoost + recencyBoost + kindBoost;
}

function nearDuplicate(left, right) {
  const leftVector = left?.embedding;
  const rightVector = right?.embedding;
  return Array.isArray(leftVector) && leftVector.length
    && Array.isArray(rightVector) && rightVector.length
    && cosineSimilarity(leftVector, rightVector) >= 0.985;
}

async function embedSafe(embeddings, text) {
  if (!embeddings?.embed || !text) return [];
  try { return await embeddings.embed(text); }
  catch (error) {
    console.warn(`Memory retrieval: ${error?.message || error}`);
    return [];
  }
}

function queryTerms(value) {
  return unique([
    ...value.match(/[\p{Script=Han}]{2,6}/gu) || [],
    ...value.match(/[a-z0-9_]{2,}/gu) || [],
  ]).slice(0, 12);
}

function uniqueById(memories) {
  const known = new Set();
  return (Array.isArray(memories) ? memories : []).filter((memory) => {
    const key = clean(memory?.id) || `${clean(memory?.namespace)}:${normalizeText(memory?.text)}`;
    if (!key || known.has(key)) return false;
    known.add(key);
    return true;
  });
}

function normalizeText(value) {
  return clean(value).toLowerCase().replace(/\s+/gu, " ");
}

function newerFirst(left, right) {
  return clean(right?.updatedAt).localeCompare(clean(left?.updatedAt));
}

function unique(values) {
  return [...new Set(values)];
}

function memorySourceRoundIds(memory) {
  if (Array.isArray(memory?.sourceRoundIds)) return memory.sourceRoundIds.map(clean).filter(Boolean);
  const encoded = clean(memory?.metadata?.sourceRoundIds);
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(encoded);
    return Array.isArray(parsed) ? parsed.map(clean).filter(Boolean) : [];
  } catch { return []; }
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
