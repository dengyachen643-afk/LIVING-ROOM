import { cosineSimilarity } from "./embeddings.js";

const DEFAULT_RECENT_COUNT = 24;
const DEFAULT_LIMIT = 12;
const MAX_CANDIDATES = 320;
const RECALL_CUE = /(?:记住|记一下|保存|还记得|之前|以前|上次|前面|刚才|那个|那件|有关|提过|说过|看过|不是.*都)/u;

export async function recallOlderConversation({
  history = [], query = "", embeddings, recentCount = DEFAULT_RECENT_COUNT, limit = DEFAULT_LIMIT,
} = {}) {
  const text = clean(query);
  const messages = (Array.isArray(history) ? history : []).filter(hasContent);
  if (!text || !RECALL_CUE.test(text) || messages.length <= recentCount) return [];

  const cutoff = Math.max(0, messages.length - recentCount);
  const candidates = messages.slice(Math.max(0, cutoff - MAX_CANDIDATES), cutoff);
  const candidateTexts = candidates.map(searchableText);
  const lexicalScores = candidateTexts.map((candidate) => lexicalScore(candidate, text));
  let semanticScores = new Array(candidates.length).fill(0);

  if (embeddings?.embed && embeddings?.embedMany) {
    try {
      const [queryVector, candidateVectors] = await Promise.all([
        embeddings.embed(text),
        embeddings.embedMany(candidateTexts),
      ]);
      semanticScores = candidateVectors.map((vector) => cosineSimilarity(queryVector, vector));
    } catch (error) {
      console.warn(`Conversation recall: ${error?.message || error}`);
    }
  }

  const ranked = candidates.map((message, index) => ({
    index,
    message,
    semantic: semanticScores[index] || 0,
    lexical: lexicalScores[index] || 0,
    score: (semanticScores[index] || 0) + Math.min(0.3, (lexicalScores[index] || 0) * 0.04),
  })).filter((item) => item.semantic >= 0.25 || item.lexical >= 2)
    .sort((left, right) => right.score - left.score || right.index - left.index);

  const selected = new Set();
  for (const match of ranked.slice(0, Math.max(3, Math.ceil(limit / 3)))) {
    for (const index of [match.index - 1, match.index, match.index + 1]) {
      if (index >= 0 && index < candidates.length) selected.add(index);
    }
  }
  return [...selected].sort((left, right) => left - right).slice(-limit).map((index) => candidates[index]);
}

function searchableText(message) {
  const author = message?.role === "user" ? "Okra" : clean(message?.author) || "AI";
  const content = clean(message?.content) || (message?.attachments?.length ? "发送了图片" : "");
  return `${author}：${content}`.slice(0, 2_000);
}

function lexicalScore(candidate, query) {
  const source = clean(candidate).toLowerCase();
  const target = clean(query).toLowerCase();
  if (!source || !target) return 0;
  const queryTerms = new Set([
    ...target.match(/[\p{Script=Han}]{2,6}/gu) || [],
    ...target.match(/[a-z0-9_]{2,}/gu) || [],
  ]);
  let score = 0;
  for (const term of queryTerms) if (source.includes(term)) score += Math.min(6, term.length);
  return score;
}

function hasContent(message) {
  return Boolean(clean(message?.content) || message?.attachments?.length);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
