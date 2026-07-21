import { cosineSimilarity } from "./embeddings.js";

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
} = {}) {
  if (!store) return [];
  const text = clean(query).slice(0, 4_000);
  const queryVector = await embedSafe(embeddings, text);
  const scope = unique((Array.isArray(namespaces) ? namespaces : [namespaces]).map(clean).filter(Boolean));
  const perNamespaceLimit = clampInt(candidateLimit, 4, 50, DEFAULT_CANDIDATE_LIMIT);
  const groups = await Promise.all(scope.map(async (namespace) => {
    const matches = await store.listMemories({ query: text, namespace, limit: perNamespaceLimit, queryVector });
    return matches.length ? matches : store.listMemories({ namespace, limit: Math.min(4, perNamespaceLimit) });
  }));
  const candidates = uniqueById(groups.flat()).map((memory) => ({
    ...memory,
    retrievalScore: rerankScore(memory, text),
  })).sort((left, right) => right.retrievalScore - left.retrievalScore || newerFirst(left, right));

  const selected = [];
  const normalizedTexts = new Set();
  const resultLimit = clampInt(limit, 1, 12, DEFAULT_RESULT_LIMIT);
  let remainingChars = clampInt(charBudget, 200, 4_000, DEFAULT_CHAR_BUDGET);
  for (const candidate of candidates) {
    if (selected.length >= resultLimit || remainingChars <= 0) break;
    const normalized = normalizeText(candidate.text);
    if (!normalized || normalizedTexts.has(normalized)) continue;
    if (selected.some((memory) => nearDuplicate(memory, candidate))) continue;
    const clippedText = [...clean(candidate.text)].slice(0, Math.min(MAX_MEMORY_CHARS, remainingChars)).join("");
    if (!clippedText) continue;
    selected.push({ ...candidate, text: clippedText });
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
  const recencyBoost = 0.12 / (1 + (ageDays / 90));
  return base + phraseBoost + termBoost + importanceBoost + recencyBoost;
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

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
