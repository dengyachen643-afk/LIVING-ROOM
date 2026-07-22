export const MEMBER_ROUND_CONTEXT_LIMIT = 30;

export function memberIdForProvider(providerId) {
  const id = String(providerId || "").trim().toLowerCase();
  if (["g", "gen", "openai", "codex-cli", "gpt"].includes(id)) return "g";
  if (id === "kimi") return "kimi";
  if (["glm", "shin"].includes(id)) return "glm";
  if (["k", "anthropic", "claude-code", "claude"].includes(id)) return "k";
  return "";
}

export function providerForMember(providers, memberId) {
  const member = memberIdForProvider(memberId);
  return (Array.isArray(providers) ? providers : []).find((provider) => (
    memberIdForProvider(provider?.id) === member && provider?.available
  ));
}

export function memberRoundsAsMessages(rounds, fallbackAuthor = "AI") {
  const messages = [];
  for (const round of Array.isArray(rounds) ? rounds : []) {
    const scene = round.scene === "group" ? "group" : privateChannel(round.memberId);
    const triggerText = clean(round.triggerText) || (round.triggerAttachments ? "（发送了图片）" : "");
    if (triggerText) messages.push({
      id: round.triggerMessageId || `${round.id}:trigger`,
      role: round.triggerAuthor === "Okra" || round.triggerAuthor === "用户" ? "user" : "assistant",
      author: normalizeAuthor(round.triggerAuthor),
      providerId: "",
      channel: scene,
      content: triggerText,
      createdAt: round.createdAt,
      memberRoundId: round.id,
    });
    if (!round.skipped && clean(round.responseText)) messages.push({
      id: round.responseMessageId || `${round.id}:response`,
      role: "assistant",
      author: clean(round.responseAuthor) || fallbackAuthor,
      providerId: providerIdForMember(round.memberId),
      channel: scene,
      content: clean(round.responseText),
      replyToId: round.triggerMessageId || "",
      createdAt: round.createdAt,
      memberRoundId: round.id,
    });
  }
  return dedupeMessages(messages).slice(-MEMBER_ROUND_CONTEXT_LIMIT * 2);
}

export async function addSuccessfulRound(store, memberId, { scene, trigger, response, skipped = false, key = "" } = {}) {
  if (!store?.addMemberRound || !memberIdForProvider(memberId) || !trigger) return null;
  return store.addMemberRound(memberIdForProvider(memberId), {
    key: clean(key) || `${scene || "private"}:${memberIdForProvider(memberId)}:${clean(trigger.id)}`,
    scene: scene === "group" ? "group" : "private",
    triggerMessageId: clean(trigger.id),
    triggerAuthor: normalizeAuthor(trigger.author),
    triggerText: clean(trigger.content) || (trigger.attachments?.length ? "（发送了图片）" : ""),
    triggerAttachments: Array.isArray(trigger.attachments) && trigger.attachments.length > 0,
    responseMessageId: clean(response?.id),
    responseAuthor: clean(response?.author),
    responseText: clean(response?.content),
    skipped: Boolean(skipped),
    createdAt: clean(response?.createdAt) || clean(trigger.createdAt) || new Date().toISOString(),
  });
}

export async function backfillMemberRounds(store) {
  if (!store?.getSnapshot || !store?.addMemberRound || !store?.listMemberRounds) return 0;
  const existing = await Promise.all(["g", "kimi", "glm", "k"].map((id) => store.listMemberRounds(id, { limit: 1 })));
  const alreadySeeded = new Set(["g", "kimi", "glm", "k"].filter((_, index) => existing[index].length));
  if (alreadySeeded.size === 4) return 0;
  const snapshot = await store.getSnapshot();
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  let count = 0;
  for (const response of messages) {
    if (response?.role !== "assistant") continue;
    const memberId = memberIdForProvider(response.providerId || response.author);
    const trigger = byId.get(response.replyToId);
    if (!memberId || alreadySeeded.has(memberId) || !trigger) continue;
    const round = await addSuccessfulRound(store, memberId, {
      scene: response.channel === "group" ? "group" : "private",
      trigger,
      response,
      key: `backfill:${memberId}:${response.id}`,
    });
    if (round) count += 1;
  }
  return count;
}

function normalizeAuthor(value) {
  const author = clean(value);
  return !author || author === "用户" ? "Okra" : author;
}

function privateChannel(memberId) {
  const member = memberIdForProvider(memberId);
  return member === "g" ? "gen" : member === "glm" ? "glm" : member;
}

function providerIdForMember(memberId) {
  const member = memberIdForProvider(memberId);
  return member === "g" ? "gen" : member;
}

function dedupeMessages(messages) {
  const seen = new Set();
  return messages.filter((message) => {
    const key = `${message.id}\u0000${message.role}\u0000${message.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clean(value) { return typeof value === "string" ? value.trim() : ""; }
