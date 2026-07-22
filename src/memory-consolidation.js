import { cosineSimilarity } from "./embeddings.js";
import { GEN_IDENTITY_PROMPT } from "./gen-persona.js";
import { KIMI_IDENTITY_PROMPT } from "./kimi-persona.js";
import { K_IDENTITY_PROMPT } from "./k-persona.js";
import { LIVING_ROOM_MEMBER_CONTEXT } from "./member-context.js";
import { retrievePromptMemories } from "./memory-retrieval.js";

export const MEMORY_REVIEW_BATCH_SIZE = 30;
const MAX_REVIEW_ACTIONS = 10;
const MEMBER_LABELS = { g: "Gen", kimi: "Kimi", glm: "Shin", k: "K" };

export async function reviewMemberMemoryBatch({ provider, memberId, rounds, store, embeddings, now = new Date() } = {}) {
  const member = normalizeMemberId(memberId);
  const batch = (Array.isArray(rounds) ? rounds : []).slice(0, MEMORY_REVIEW_BATCH_SIZE);
  if (!provider?.generate || !member || batch.length < MEMORY_REVIEW_BATCH_SIZE || !store) return { status: "skipped", actions: [] };
  const query = batch.map((round) => `${round.triggerText} ${round.responseText}`).join(" ").slice(0, 4_000);
  const existing = await retrievePromptMemories({
    store, embeddings, query, namespaces: [member, "shared"], candidateLimit: 20, limit: 10, charBudget: 2_000,
  });
  const raw = await provider.generate({
    system: buildMemoryReviewSystem(member),
    prompt: buildMemoryReviewPrompt(member, batch, existing, now),
    images: [],
    allowWebSearch: false,
    thinkingEnabled: true,
    searchText: "",
  });
  const decision = parseMemoryReviewDecision(raw, batch);
  if (!decision.valid) throw new Error(`${MEMBER_LABELS[member]} 的 30 轮记忆复盘格式无效`);
  const changes = await applyMemoryReviewDecision({ memberId: member, decision, rounds: batch, store, embeddings, now });
  await store.completeMemberReview(member, batch.at(-1).sequence);
  return { status: "done", actions: changes };
}

export function buildMemoryReviewSystem(memberId) {
  const member = normalizeMemberId(memberId);
  const identity = member === "g" ? GEN_IDENTITY_PROMPT
    : member === "kimi" ? KIMI_IDENTITY_PROMPT
      : member === "glm" ? "你是 Shin，27 岁的 ENTP 男性，在上海从事广告策略策划。你反应快、现实、懂人情，有自己的判断。"
        : K_IDENTITY_PROMPT;
  return [
    identity,
    LIVING_ROOM_MEMBER_CONTEXT,
    "你现在不是在回复任何一条聊天消息，而是在复盘自己刚完成的 30 个互动轮次。只提取未来真正有用的原子记忆，不写人物档案，不总结全部聊天，也不为了填满分类而硬记。",
    "长期记忆至少未来数周仍有价值；短期记忆是近期状态、计划和持续话题；shared 是全体成员可知道的稳定公共事实；事件记忆记录有明确时间、参与者和后续意义的节点。",
    "私聊默认绝不能进入 shared。只有发生在群聊中的公开信息，或 Okra 明确授权大家知道的私聊信息，才可以提交 shared 或 shared 事件。",
    "每条记忆只表达一个事实或紧密主题，推荐不超过 80 字。不要保存寒暄、临时技术操作、普通修 bug、模型运行信息、API Key、密码、付款资料或精确住址。",
    "必须输出一个 JSON 对象，不使用 Markdown，不输出解释。",
  ].join("\n");
}

export function buildMemoryReviewPrompt(memberId, rounds, existing, now = new Date()) {
  const label = MEMBER_LABELS[normalizeMemberId(memberId)] || memberId;
  const timeline = rounds.map((round) => [
    `[ROUND:${round.id}] [${round.createdAt}] [${round.scene === "group" ? "群聊" : "P2P私聊"}]`,
    `${round.triggerAuthor || "Okra"}：${clip(round.triggerText, 1_200) || "（图片或空消息）"}`,
    round.skipped ? `${label}：[[SKIPPED]]` : `${label}：${clip(round.responseText, 1_500)}`,
  ].join("\n")).join("\n\n");
  const known = existing.length
    ? existing.map((memory) => `- [${memory.id}] [${memory.memoryKind || "long_term"}/${memory.namespace}] ${memory.text}`).join("\n")
    : "- 暂无相关已有记忆";
  return [
    `复盘时间：${now.toISOString()}`,
    `你是 ${label}。以下是只属于你的连续 30 个互动轮次，已经按真实时间排列：`,
    timeline,
    "",
    "已有相关记忆（用于避免重复和发现修正）：",
    known,
    "",
    "输出结构：",
    '{"long_term":[{"text":"","importance":1到5,"evidence_round_ids":["ROUND ID"]}],"short_term":[{"text":"","tier":"hot|active|fading","importance":1到5,"evidence_round_ids":["ROUND ID"]}],"shared":[{"text":"","importance":1到5,"evidence_round_ids":["ROUND ID"]}],"events":[{"text":"","date":"YYYY-MM-DD","participants":["Okra","Gen","Kimi","Shin","K"],"visibility":"private|shared","importance":1到5,"evidence_round_ids":["ROUND ID"]}]}',
    "四类合计最多 10 条；长期最多 4 条、短期最多 4 条、shared 最多 3 条、事件最多 3 条。没有值得记录的内容时对应数组留空。",
    "短期层级：hot 约 3 天，active 约 14 天，fading 约 30 天。shared 和 shared 事件必须填写支持它的 ROUND ID；服务端会再次检查该轮是否为群聊或获得 Okra 的明确公开授权。",
  ].join("\n");
}

export function parseMemoryReviewDecision(value, rounds = []) {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object") return { valid: false };
  const knownRounds = new Set(rounds.map((round) => clean(round.id)).filter(Boolean));
  const longTerm = normalizeProposals(parsed.long_term, 4).map((item) => ({
    ...item, evidenceRoundIds: normalizeEvidence(item.raw?.evidence_round_ids, knownRounds),
  }));
  const shortTerm = normalizeProposals(parsed.short_term, 4).map((item) => ({
    ...item,
    tier: normalizeTier(item.raw?.tier),
    evidenceRoundIds: normalizeEvidence(item.raw?.evidence_round_ids, knownRounds),
  }));
  const shared = normalizeProposals(parsed.shared, 3).map((item) => ({
    ...item, evidenceRoundIds: normalizeEvidence(item.raw?.evidence_round_ids, knownRounds),
  }));
  const events = normalizeProposals(parsed.events, 3).map((item) => ({
    ...item,
    date: normalizeDate(item.raw?.date),
    participants: normalizeParticipants(item.raw?.participants),
    visibility: clean(item.raw?.visibility).toLowerCase() === "shared" ? "shared" : "private",
    evidenceRoundIds: normalizeEvidence(item.raw?.evidence_round_ids, knownRounds),
  }));
  const combined = [...longTerm, ...shortTerm, ...shared, ...events].slice(0, MAX_REVIEW_ACTIONS);
  const allowed = new Set(combined);
  return {
    valid: true,
    longTerm: longTerm.filter((item) => allowed.has(item)),
    shortTerm: shortTerm.filter((item) => allowed.has(item)),
    shared: shared.filter((item) => allowed.has(item)),
    events: events.filter((item) => allowed.has(item)),
  };
}

export async function applyMemoryReviewDecision({ memberId, decision, rounds, store, embeddings, now = new Date() }) {
  const changes = [];
  const roundMap = new Map(rounds.map((round) => [round.id, round]));
  const allRoundIds = rounds.map((round) => round.id);
  for (const proposal of decision.longTerm || []) {
    const changed = await upsertLongMemory({ store, embeddings, namespace: memberId, proposal, sourceRoundIds: proposal.evidenceRoundIds, confirmedBy: [MEMBER_LABELS[memberId]] });
    if (changed) changes.push(changed);
  }
  for (const proposal of decision.shortTerm || []) {
    const changed = await upsertShortMemory({ store, embeddings, namespace: memberId, proposal, sourceRoundIds: proposal.evidenceRoundIds, now });
    if (changed) changes.push(changed);
  }
  for (const proposal of decision.shared || []) {
    if (!isPublicEvidence(proposal.evidenceRoundIds, roundMap)) continue;
    const changed = await upsertLongMemory({ store, embeddings, namespace: "shared", proposal, sourceRoundIds: proposal.evidenceRoundIds, confirmedBy: [MEMBER_LABELS[memberId]], shared: true });
    if (changed) changes.push(changed);
  }
  for (const proposal of decision.events || []) {
    const namespace = proposal.visibility === "shared" && isPublicEvidence(proposal.evidenceRoundIds, roundMap) ? "shared" : memberId;
    const changed = await upsertEventMemory({ store, embeddings, namespace, proposal, sourceRoundIds: proposal.evidenceRoundIds.length ? proposal.evidenceRoundIds : allRoundIds, confirmedBy: [MEMBER_LABELS[memberId]], now });
    if (changed) changes.push(changed);
  }
  return changes;
}

async function upsertLongMemory({ store, embeddings, namespace, proposal, sourceRoundIds, confirmedBy, shared = false }) {
  const embedding = await embedSafe(embeddings, proposal.text);
  const matches = await store.listMemories({ query: proposal.text, namespace, limit: 5, queryVector: embedding });
  const match = findCanonicalMatch(matches, proposal.text, embedding);
  if (match?.conflict && shared) return null;
  const metadata = {
    memoryKind: "long_term",
    confirmedBy: JSON.stringify(unique(confirmedBy)),
    sourceRoundIds: JSON.stringify(unique(sourceRoundIds)),
  };
  if (match?.memory) {
    const text = chooseRicherText(match.memory.text, proposal.text);
    const mergedMetadata = {
      ...(match.memory.metadata || {}),
      ...metadata,
      confirmedBy: JSON.stringify(unique([
        ...parseMetadataArray(match.memory.metadata?.confirmedBy), ...confirmedBy,
      ])),
      sourceRoundIds: JSON.stringify(unique([
        ...parseMetadataArray(match.memory.metadata?.sourceRoundIds), ...sourceRoundIds,
      ]).slice(0, 80)),
    };
    const updated = await store.updateMemory(match.memory.id, {
      text,
      importance: Math.max(Number(match.memory.importance) || 3, proposal.importance),
      metadata: mergedMetadata,
    });
    if (embedding.length && updated && text !== match.memory.text) await store.setMemoryEmbedding(updated.id, { embedding, model: embeddings?.model || "" });
    return { type: "long_term", action: "updated", memory: updated };
  }
  const created = await store.addMemory({ text: proposal.text, namespace, importance: proposal.importance, source: "30-round-review", metadata });
  const indexed = embedding.length ? await store.setMemoryEmbedding(created.id, { embedding, model: embeddings?.model || "" }) : created;
  return { type: "long_term", action: "created", memory: indexed };
}

async function upsertShortMemory({ store, embeddings, namespace, proposal, sourceRoundIds, now }) {
  const embedding = await embedSafe(embeddings, proposal.text);
  const matches = await store.listShortTermMemories({ query: proposal.text, namespace, limit: 5, queryVector: embedding, now: now.toISOString() });
  const match = findCanonicalMatch(matches, proposal.text, embedding);
  const days = proposal.tier === "hot" ? 3 : proposal.tier === "fading" ? 30 : 14;
  const created = await store.addShortTermMemory({
    text: proposal.text,
    namespace,
    tier: proposal.tier,
    importance: proposal.importance,
    fingerprint: match?.memory?.fingerprint,
    sourceRoundIds,
    embedding,
    embeddingModel: embeddings?.model || "",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
  });
  return { type: "short_term", action: match?.memory ? "updated" : "created", memory: created };
}

async function upsertEventMemory({ store, embeddings, namespace, proposal, sourceRoundIds, confirmedBy, now }) {
  const embedding = await embedSafe(embeddings, `${proposal.date} ${proposal.participants.join(" ")} ${proposal.text}`);
  const matches = await store.listEventMemories({ query: proposal.text, namespace, limit: 5, queryVector: embedding });
  const match = findCanonicalMatch(matches, proposal.text, embedding);
  if (match?.conflict && namespace === "shared") return null;
  const created = await store.addEventMemory({
    text: proposal.text,
    namespace,
    date: proposal.date || now.toISOString().slice(0, 10),
    participants: proposal.participants,
    importance: proposal.importance,
    fingerprint: match?.memory?.fingerprint,
    confirmedBy,
    sourceRoundIds,
    embedding,
    embeddingModel: embeddings?.model || "",
    createdAt: now.toISOString(),
  });
  return { type: "event", action: match?.memory ? "updated" : "created", memory: created };
}

function findCanonicalMatch(matches, text, embedding) {
  const normalized = normalizeText(text);
  for (const memory of matches || []) {
    if (normalizeText(memory.text) === normalized) return { memory, conflict: false };
    const similarity = embedding.length ? cosineSimilarity(memory.embedding, embedding) : Number(memory.vectorScore) || 0;
    if (similarity < 0.9) continue;
    return { memory, conflict: likelyConflict(memory.text, text) };
  }
  return null;
}

function likelyConflict(left, right) {
  const a = clean(left);
  const b = clean(right);
  const numbersA = new Set(a.match(/\d+(?:\.\d+)?/gu) || []);
  const numbersB = new Set(b.match(/\d+(?:\.\d+)?/gu) || []);
  if (numbersA.size && numbersB.size && ![...numbersA].some((item) => numbersB.has(item))) return true;
  return /(?:不是|不再|已经不|并非|取消)/u.test(a) !== /(?:不是|不再|已经不|并非|取消)/u.test(b);
}

function isPublicEvidence(ids, roundMap) {
  if (!ids.length) return false;
  return ids.every((id) => {
    const round = roundMap.get(id);
    return round?.scene === "group" || /(?:大家都可以知道|可以告诉大家|可以公开|群里也可以说|共享)/u.test(round?.triggerText || "");
  });
}

function normalizeProposals(value, limit) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map((raw) => ({
    raw,
    text: clip(raw?.text, 200),
    importance: clampInt(raw?.importance, 1, 5, 3),
  })).filter((item) => item.text);
}

function normalizeEvidence(value, knownRounds) {
  return unique((Array.isArray(value) ? value : []).map(clean).filter((id) => knownRounds.has(id))).slice(0, 10);
}

function normalizeParticipants(value) {
  const aliases = { okra: "Okra", gen: "Gen", kimi: "Kimi", shin: "Shin", k: "K" };
  return unique((Array.isArray(value) ? value : []).map((item) => aliases[clean(item).toLowerCase()]).filter(Boolean)).slice(0, 5);
}

function normalizeDate(value) {
  const match = clean(value).match(/^\d{4}-\d{2}-\d{2}$/u);
  return match ? match[0] : "";
}

function normalizeTier(value) {
  const tier = clean(value).toLowerCase();
  return ["hot", "active", "fading"].includes(tier) ? tier : "active";
}

function normalizeMemberId(value) {
  const id = clean(value).toLowerCase();
  if (["gen", "openai", "codex-cli", "gpt"].includes(id)) return "g";
  if (["shin", "glm"].includes(id)) return "glm";
  if (["anthropic", "claude-code"].includes(id)) return "k";
  return ["g", "kimi", "glm", "k"].includes(id) ? id : "";
}

function parseJson(value) {
  const text = clean(value).replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try { return JSON.parse(text); } catch { /* try object */ }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function embedSafe(embeddings, text) {
  if (!embeddings?.embed || !clean(text)) return [];
  try { return await embeddings.embed(text); } catch { return []; }
}

function chooseRicherText(left, right) {
  return [...clean(right)].length > [...clean(left)].length ? clean(right) : clean(left);
}

function normalizeText(value) {
  return clean(value).toLowerCase().replace(/[\s，。！？、,.!?;；:："“”'‘’（）()\[\]]+/gu, "");
}

function unique(values) { return [...new Set(values)]; }
function parseMetadataArray(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  try {
    const parsed = JSON.parse(clean(value));
    return Array.isArray(parsed) ? parsed.map(clean).filter(Boolean) : [];
  } catch { return []; }
}
function clip(value, max) { return [...clean(value)].slice(0, max).join(""); }
function clean(value) { return typeof value === "string" ? value.trim() : ""; }
function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
