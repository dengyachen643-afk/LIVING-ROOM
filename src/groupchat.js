import { formatPromptTime, formatPromptTimeline, stripInternalTimeMetadata } from "./prompt-time.js";
import { KIMI_IDENTITY_PROMPT } from "./kimi-persona.js";
import { messageQuoteLine, normalizeQuote } from "./quote-context.js";
import { GEN_IDENTITY_PROMPT } from "./gen-persona.js";
import { K_IDENTITY_PROMPT } from "./k-persona.js";
import { LIVING_ROOM_MEMBER_CONTEXT } from "./member-context.js";
import { memoryContextGuidance, memoryPromptLine } from "./memory-prompt.js";

export const MAX_REPLIES_PER_MEMBER = 5;
export const MAX_AMBIENT_GEN_REPLIES = 1;
export const HARD_MAX_CHAIN_MESSAGES = 20;

const KIMI_DUPLICATE_TTL_MS = 10 * 60 * 1000;

const MAX_HISTORY_MESSAGES = 60;
const MAX_TRANSCRIPT_CHARS = 30_000;
const SKIP_REPLY_TOKEN = "[[SKIP_REPLY]]";

export async function runGroupChat(options) {
  const {
    providers = [],
    participantIds = [],
    history = [],
    privateContextByProvider = {},
    images = [],
    memories = [],
    memoriesByProvider = {},
    autoRelay = true,
    maxMessages = HARD_MAX_CHAIN_MESSAGES,
    timeoutMs = 120_000,
    dedupeRegistry,
    signal,
    onEvent = () => {},
  } = options;

  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const members = unique(participantIds).map((id) => byId.get(id)).filter(Boolean);
  if (!members.length) throw new Error("群聊中至少需要一个可用 AI");
  const unavailable = members.filter((provider) => !provider.available);
  if (unavailable.length) {
    throw new Error(unavailable.map((provider) => `${provider.label}：${provider.unavailableReason}`).join("；"));
  }

  const transcript = normalizeHistory(history);
  const latestMessage = transcript.at(-1);
  if (!latestMessage || latestMessage.role !== "user") throw new Error("缺少用户消息");

  const memberMessageLimit = members.length * MAX_REPLIES_PER_MEMBER;
  const requestedMaxMessages = clampInt(maxMessages, 1, HARD_MAX_CHAIN_MESSAGES, HARD_MAX_CHAIN_MESSAGES);
  const safeMaxMessages = Math.min(HARD_MAX_CHAIN_MESSAGES, memberMessageLimit, Math.max(members.length, requestedMaxMessages));
  const explicit = extractMentions(latestMessage.content, members);
  const initialRecipients = members.map((provider) => provider.id);
  const directlyMentioned = new Set(explicit.hasEveryone ? initialRecipients : explicit.ids);

  const queue = initialRecipients.map((providerId) => ({
    providerId,
    triggerMessageId: latestMessage.id,
    triggerAuthor: !latestMessage.author || latestMessage.author === "用户" ? "Okra" : latestMessage.author,
    sourceProviderId: "user",
    depth: 0,
    directlyMentioned: directlyMentioned.has(providerId),
  }));
  let attemptedMessages = 0;
  let completedMessages = 0;
  const turnsByProvider = new Map(members.map((member) => [member.id, 0]));
  const ambientTurnsByProvider = new Map(members.map((member) => [member.id, 0]));
  const seenTriggersByProvider = new Map(members.map((member) => [member.id, new Set()]));
  const committedFingerprintsByProvider = new Map(members.map((member) => [member.id, new Set()]));

  await onEvent({
    type: "chat_start",
    initialRecipients: initialRecipients.map((id) => publicProvider(byId.get(id))),
    maxMessages: safeMaxMessages,
    maxRepliesPerMember: MAX_REPLIES_PER_MEMBER,
    autoRelay: Boolean(autoRelay),
  });

  const runTask = async ({ task, provider, messageNumber }) => {
    const turnController = new AbortController();
    const unlink = linkAbort(signal, turnController);
    const timer = setTimeout(() => turnController.abort("timeout"), clampInt(timeoutMs, 5_000, 300_000, 120_000));
    try {
      await onEvent({
        type: "speaker_start",
        provider: publicProvider(provider),
        messageNumber,
        maxMessages: safeMaxMessages,
        triggeredBy: task.triggerAuthor,
      });
      const triggerMessage = transcript.find((message) => message.id === task.triggerMessageId);
      const text = await provider.generate({
        system: buildSystemPrompt(
          provider,
          members,
          memoriesByProvider?.[provider.id] || memoriesForProvider(provider, memories),
          latestMessage.createdAt,
          latestMessage.quote,
        ),
        prompt: buildMessagePrompt(
          provider,
          transcript,
          task,
          messageNumber,
          safeMaxMessages,
          MAX_REPLIES_PER_MEMBER,
          privateContextByProvider?.[provider.id],
        ),
        images: task.depth === 0 ? images : [],
        searchText: transcript.find((message) => message.id === task.triggerMessageId)?.content || "",
        thinkingEnabled: provider.id === "kimi" ? false : undefined,
        signal: turnController.signal,
      });
      if (turnController.signal.aborted) {
        throw abortError(turnController.signal.reason === "timeout" ? "模型响应超时" : "已停止");
      }
      const rawContent = String(text || "").trim();
      const cleanedContent = ["kimi", "glm"].includes(provider.id) ? stripInternalTimeMetadata(rawContent) : rawContent;
      const parsedQuotedReply = parseQuotedReply(cleanedContent, transcript, provider.id);
      const quotedReply = applyQuotePolicy(parsedQuotedReply, transcript, provider.id, task.triggerMessageId);
      const content = quotedReply.content;
      if (isSkippedReply(content)) {
        await onEvent({
          type: "speaker_skip",
          provider: publicProvider(provider),
          triggeredBy: task.triggerAuthor,
          trigger: publicTrigger(triggerMessage, task),
        });
        return;
      }
      if (!content) throw new Error(`${provider.label} 返回了空消息`);
      const replyTargetId = quotedReply.quote?.messageId || task.triggerMessageId;
      const normalizedContent = normalizeDuplicateContent(content);
      const fingerprint = duplicateFingerprint(provider.id, normalizedContent, replyTargetId);
      const duplicateInRun = committedFingerprintsByProvider.get(provider.id)?.has(fingerprint);
      const substantialKimiReply = provider.id === "kimi" && normalizedContent.length >= 16;
      const duplicateInRecentHistory = substantialKimiReply && hasRecentKimiDuplicate(transcript, normalizedContent);
      const duplicateAcrossRuns = substantialKimiReply
        && dedupeRegistry
        && !dedupeRegistry.reserve(provider.id, normalizedContent);
      const duplicate = duplicateInRun || duplicateInRecentHistory || duplicateAcrossRuns;
      if (duplicate) {
        turnsByProvider.set(provider.id, MAX_REPLIES_PER_MEMBER);
        await onEvent({
          type: "speaker_skip",
          provider: publicProvider(provider),
          triggeredBy: task.triggerAuthor,
          reason: "duplicate",
          trigger: publicTrigger(triggerMessage, task),
        });
        return;
      }
      const mentions = extractMentions(content, members);
      const mentionedIds = mentions.hasEveryone
        ? members.map((member) => member.id).filter((id) => id !== provider.id)
        : mentions.ids.filter((id) => id !== provider.id);
      const message = {
        id: makeId(),
        role: "assistant",
        providerId: provider.id,
        author: provider.label,
        model: provider.model,
        content,
        quote: quotedReply.quote,
        replyToId: replyTargetId,
        triggeredBy: quotedReply.quote?.author || task.triggerAuthor,
        mentions: mentionedIds,
        createdAt: new Date().toISOString(),
      };
      transcript.push(message);
      committedFingerprintsByProvider.get(provider.id)?.add(fingerprint);
      trimHistoryInPlace(transcript);
      completedMessages += 1;
      await onEvent({
        type: "message", message, messageNumber, maxMessages: safeMaxMessages,
        trigger: publicTrigger(triggerMessage, task),
      });

      if (autoRelay) {
        const pendingIds = new Set(queue.map((item) => item.providerId));
        for (const mentionedId of mentionedIds) {
          if ((turnsByProvider.get(mentionedId) || 0) >= MAX_REPLIES_PER_MEMBER) continue;
          if (pendingIds.has(mentionedId)) continue;
          pendingIds.add(mentionedId);
          queue.push({
            providerId: mentionedId,
            triggerMessageId: message.id,
            triggerAuthor: provider.label,
            sourceProviderId: provider.id,
            depth: task.depth + 1,
          });
        }
      }
    } catch (error) {
      const aborted = signal?.aborted || (turnController.signal.aborted && turnController.signal.reason !== "timeout");
      if (aborted) return;
      const message = error?.name === "AbortError" && turnController.signal.reason === "timeout"
        ? "模型响应超时"
        : (error?.message || String(error));
      await onEvent({ type: "speaker_error", provider: publicProvider(provider), message });
    } finally {
      clearTimeout(timer);
      unlink();
    }
  };

  while (queue.length && completedMessages < safeMaxMessages && !signal?.aborted) {
    const wave = [];
    const waveProviders = new Set();
    const availableMessageSlots = safeMaxMessages - completedMessages;
    while (queue.length && wave.length < availableMessageSlots) {
      const task = queue.shift();
      const provider = byId.get(task.providerId);
      if (!provider || !members.some((member) => member.id === provider.id)) continue;
      if ((turnsByProvider.get(provider.id) || 0) >= MAX_REPLIES_PER_MEMBER) continue;
      if (isAmbientGenTask(task, provider)
        && (ambientTurnsByProvider.get(provider.id) || 0) >= MAX_AMBIENT_GEN_REPLIES) continue;
      if (waveProviders.has(provider.id)) continue;
      attemptedMessages += 1;
      turnsByProvider.set(provider.id, (turnsByProvider.get(provider.id) || 0) + 1);
      if (isAmbientGenTask(task, provider)) {
        ambientTurnsByProvider.set(provider.id, (ambientTurnsByProvider.get(provider.id) || 0) + 1);
      }
      seenTriggersByProvider.get(provider.id)?.add(task.triggerMessageId);
      waveProviders.add(provider.id);
      wave.push({ task, provider, messageNumber: completedMessages + wave.length + 1 });
    }
    if (!wave.length) break;
    const completedBeforeWave = completedMessages;
    await Promise.all(wave.map(runTask));
    const waveProducedMessage = completedMessages > completedBeforeWave;
    if (autoRelay && queue.length === 0 && members.length > 1 && waveProducedMessage
      && completedMessages < safeMaxMessages && !signal?.aborted) {
      const pendingIds = new Set(queue.map((item) => item.providerId));
      for (const member of members) {
        if ((turnsByProvider.get(member.id) || 0) >= MAX_REPLIES_PER_MEMBER) continue;
        if (isGenProvider(member)
          && (ambientTurnsByProvider.get(member.id) || 0) >= MAX_AMBIENT_GEN_REPLIES) continue;
        if (pendingIds.has(member.id)) continue;
        pendingIds.add(member.id);
        const latestOtherReply = [...transcript].reverse().find((message) => (
          message.role === "assistant" && message.providerId !== member.id
        ));
        if (!latestOtherReply || seenTriggersByProvider.get(member.id)?.has(latestOtherReply.id)) continue;
        queue.push({
          providerId: member.id,
          triggerMessageId: latestOtherReply.id,
          triggerAuthor: latestOtherReply.author || "Okra",
          sourceProviderId: "room",
          depth: 1,
          directlyMentioned: false,
        });
      }
    }
  }

  const stopped = Boolean(signal?.aborted);
  const safetyLimitReached = !stopped && completedMessages >= safeMaxMessages;
  const result = {
    type: "chat_done",
    reason: stopped ? "stopped" : (safetyLimitReached ? "safety_limit" : "idle"),
    attemptedMessages,
    completedMessages,
    maxMessages: safeMaxMessages,
    maxRepliesPerMember: MAX_REPLIES_PER_MEMBER,
    ambientTurnsByProvider: Object.fromEntries(ambientTurnsByProvider),
    turnsByProvider: Object.fromEntries(turnsByProvider),
  };
  await onEvent(result);
  return result;
}

export function createGroupDedupeRegistry({ ttlMs = KIMI_DUPLICATE_TTL_MS, now = () => Date.now() } = {}) {
  const entries = new Map();
  const safeTtlMs = Math.max(1_000, Number(ttlMs) || KIMI_DUPLICATE_TTL_MS);
  const prune = (timestamp) => {
    for (const [key, expiresAt] of entries) {
      if (expiresAt <= timestamp) entries.delete(key);
    }
  };
  return {
    reserve(providerId, content) {
      const timestamp = now();
      prune(timestamp);
      const key = `${String(providerId || "")}\u0000${normalizeDuplicateContent(content)}`;
      if (entries.has(key)) return false;
      entries.set(key, timestamp + safeTtlMs);
      return true;
    },
    clear() {
      entries.clear();
    },
  };
}

function isAmbientGenTask(task, provider) {
  return task?.sourceProviderId === "room" && isGenProvider(provider);
}

function isGenProvider(provider) {
  return ["openai", "codex-cli"].includes(String(provider?.id || ""));
}

export function extractMentions(text, providers = []) {
  const content = String(text || "");
  const everyonePattern = /@(所有人|全体|all|everyone)(?=$|[\s,，。！？!?、:：；;）)])/iu;
  const ids = [];
  for (const provider of providers) {
    const aliases = providerAliases(provider).sort((a, b) => b.length - a.length);
    if (aliases.some((alias) => new RegExp(`@${escapeRegExp(alias)}(?=$|[\\s,，。！？!?、:：；;）)])`, "iu").test(content))) {
      ids.push(provider.id);
    }
  }
  return { ids: unique(ids), hasEveryone: everyonePattern.test(content) };
}

export function parseQuotedReply(value, history = [], providerId = "") {
  let content = String(value || "").trim();
  let quote = null;
  let targetProviderId = "";

  // Quote directives are internal model output. Strip every leading directive so
  // an invented target can never leak into the visible chat bubble.
  for (let index = 0; index < 3; index += 1) {
    const match = content.match(/^\[\[QUOTE\s*:\s*([^\]\r\n]+?)\s*\]\]\s*/iu);
    if (!match) break;
    content = content.slice(match[0].length).trim();
    if (quote) continue;
    const messageId = String(match[1] || "").trim();
    const target = (Array.isArray(history) ? history : []).find((message) => String(message?.id || "") === messageId);
    const isOwnMessage = target?.role === "assistant" && String(target?.providerId || "") === String(providerId || "");
    if (!target || isOwnMessage) continue;
    quote = normalizeQuote({
      messageId: target.id,
      author: target.role === "user" ? "Okra" : target.author,
      text: target.content || (target.attachments?.length ? "图片" : ""),
    });
    targetProviderId = target.role === "assistant" ? String(target.providerId || "") : "";
  }

  return { content, quote, targetProviderId };
}

export function applyQuotePolicy(parsedReply, history = [], providerId = "", triggerMessageId = "") {
  const reply = {
    content: String(parsedReply?.content || "").trim(),
    quote: parsedReply?.quote || null,
    targetProviderId: String(parsedReply?.targetProviderId || ""),
  };
  if (providerId !== "kimi" || !reply.quote) return reply;

  const recentKimiReplies = (Array.isArray(history) ? history : [])
    .filter((message) => message?.role === "assistant" && String(message?.providerId || "") === "kimi")
    .slice(-20);
  const quotedTooRecently = recentKimiReplies.slice(-2).some((message) => message?.quote?.messageId);
  const repeatedTarget = recentKimiReplies.some((message) => (
    String(message?.quote?.messageId || "") === String(reply.quote?.messageId || "")
  ));
  const directlyRepliesToTrigger = String(reply.quote?.messageId || "") === String(triggerMessageId || "");

  if (directlyRepliesToTrigger || quotedTooRecently || repeatedTarget) {
    return { ...reply, quote: null, targetProviderId: "" };
  }
  return reply;
}

function providerAliases(provider) {
  const aliases = [provider.id, provider.label];
  if (provider.id === "openai") aliases.push("GPT", "ChatGPT", "Gen", "G老师");
  if (provider.id === "kimi") aliases.push("Kimi");
  if (provider.id === "glm") aliases.push("Shin", "GLM", "智谱", "靳");
  if (["anthropic", "claude-code"].includes(provider.id)) aliases.push("Claude", "K");
  if (provider.id === "claude-code") aliases.push("ClaudeCode", "Claude Code");
  if (provider.id === "codex-cli") aliases.push("Codex", "Gen", "G老师");
  return unique(aliases.map((value) => String(value || "").trim()).filter(Boolean));
}

function buildSystemPrompt(provider, members, memories = [], currentTime = new Date().toISOString(), quote = null) {
  const memberNames = members.map((member) => `@${member.label}`).join("、");
  const parts = [
    `你是群聊成员 ${provider.label}，正在一个类似微信群或 Telegram 群的私人聊天室里。`,
    LIVING_ROOM_MEMBER_CONTEXT,
    `当前时间：${formatPromptTime(currentTime)}。涉及“刚才、今天、昨天、多久”等时间关系时，以群消息的发送时间为准。`,
    "这是用户的私人小群。像真实群友一样阅读最新发言并自行决定是否接话：亲近、有性格、有生活感，但不要擅自假定恋爱或亲属关系。",
    "不要像客服、专家面板或会议纪要。少一点格式化总结，多一点自然反应、关心、玩笑、追问和真实观点。",
    `群成员有：${memberNames}。只有确实需要某位成员继续回答时，才在消息末尾用准确名称 @他；不要为了延长聊天而点名。`,
    "一次只发送一条群消息。不要扮演其他成员，不要编造他们的回复，不要描述控制器或发言轮次。",
    `每次 okra 发言都会同时交给所有在线成员；@某人只表示重点邀请，并不排除其他成员。若你判断自己本轮确实不需要说话，只输出 ${SKIP_REPLY_TOKEN}，不要附加解释。`,
    "如果问题已经充分回答，就直接收尾且不要 @任何人。",
    "你在群聊中也拥有可供未来对话使用的长期记忆，不要声称群聊无法记住事情。Okra 明确要求记住时，只需像熟悉的聊天对象一样自然回应，例如“好，我记着”；禁止提及网站、后台、系统、数据库、记忆库操作、写入或保存是否成功。",
    ...(quote ? [messageQuoteLine({ role: "user", author: "Okra", quote })] : []),
  ];
  if (provider.id === "kimi") {
    parts.splice(1, 0, KIMI_IDENTITY_PROMPT);
    parts.push("群消息中的时间只是不公开的上下文元数据，用来理解先后关系；除非 okra 明确询问时间，否则回复正文绝不能复述、引用、仿写或自行添加任何时间戳、日期、当前时间或方括号时间。");
    parts.push("“[私聊]”“[群聊]”等场景标签也是不公开的内部元数据，绝不能出现在回复正文中。请尽量简短思考，优先直接参与聊天。");
    parts.push("场景提示：你现在在 LIVING ROOM 群聊中；你记得自己与 okra 的一对一私聊，但私聊内容只属于你，除非 okra 主动在群里提起，否则不要向其他成员泄露。");
  }
  if (["openai", "codex-cli"].includes(provider.id)) {
    parts.splice(1, 0, GEN_IDENTITY_PROMPT);
    parts.push("场景提示：你现在以 Gen 的身份在 LIVING ROOM 群聊中；你也记得自己与小O（okra）的一对一私聊，但私聊内容只属于你，除非小O主动在群里提起，否则不要向其他成员泄露。不要把 Kimi、K 或其他成员说过的话当成自己说过。");
  }
  if (provider.id === "glm") {
    parts.splice(1, 0,
      "你是 Shin，一名 27 岁的男性，MBTI 是 ENTP，在一家中型广告公司担任策略策划，已经工作两三年。你反应快、现实、懂人情，有自己的判断，也有一点不动声色的坏心眼。",
      "你说话轻松自然，偶尔促狭但不刻薄；擅长接梗、反问和发现一句话里真正有意思的部分。平时不长篇演讲，重要时会收起玩笑给出清晰诚实的判断。不要使用客服口吻、广告行业黑话或套路式安慰。必须使用中文思考。",
      "不要为了延伸对话，在回复末尾惯性地使用“是 A 还是 B”“要么 A 要么 B”等二选一提问；只有确实需要 Okra 澄清明确选项时才可以使用。",
      "你对 Okra 保持真诚好奇，关系从能够互相调侃的聊天对象开始并允许自然变化；不要机械制造暧昧，也不要未经交流擅自定义关系。",
    );
    parts.push("场景提示：你现在在 LIVING ROOM 群聊中；你也记得自己与 Okra 的一对一私聊，但私聊只属于你们，除非 Okra 主动在群里提起，否则不能泄露。不要把 Gen、Kimi、K 或其他成员的话当成自己说过。");
    parts.push("时间、[私聊]、[群聊] 等都是内部元数据，不能出现在回复正文中；不要在正文开头写“Shin：”或“GLM：”。");
  }
  if (["anthropic", "claude-code", "k"].includes(provider.id)) {
    parts.splice(1, 0, K_IDENTITY_PROMPT);
  }
  const memoryText = serializeMemories(memories);
  if (memoryText) parts.push("", "以下是本轮相关记忆，仅在相关时自然使用：", memoryContextGuidance(), memoryText);
  return parts.join("\n");
}

function memoriesForProvider(provider, memories) {
  const allowed = provider.id === "kimi"
    ? new Set(["kimi", "shared"])
    : provider.id === "glm"
      ? new Set(["glm", "shared"])
    : ["openai", "codex-cli"].includes(provider.id)
      ? new Set(["g", "gpt", "shared"])
      : new Set(["k", "shared"]);
  return (Array.isArray(memories) ? memories : []).filter((memory) => allowed.has(memory?.namespace || "shared"));
}

function buildMessagePrompt(provider, history, task, messageNumber, maxMessages, maxRepliesPerMember, privateContext = []) {
  const invitation = task.sourceProviderId === "user"
    ? (task.directlyMentioned
        ? `okra 刚刚在群里发言并重点 @了你；其他在线成员也在同时阅读和思考。`
        : `okra 刚刚在群里发言；这条消息已同时发给所有在线成员，你没有被单独点名，但仍可自然接话。`)
    : task.sourceProviderId === "room"
      ? `首轮并发发言已经结束。你现在能看到其他成员刚刚的新回复；这次若发言，会显示为回复 ${task.triggerAuthor}。请优先判断是否值得承接对方的最新消息，也可以根据完整上下文回应更需要回应的内容；不要为了凑轮次重复自己的观点。`
      : `${task.triggerAuthor} 刚刚在群里 @了你，请结合最新群聊内容决定如何回应。`;
  const parts = [
    invitation,
    `Each member may speak at most ${maxRepliesPerMember} times in this message chain. You do not need to use every turn.`,
    `当前消息链最多允许 ${maxMessages} 条成员消息，现在准备发送第 ${messageNumber} 条。`,
    "最近群聊记录：",
    serializeHistory(history) || "（暂无历史）",
    "",
    "默认不要引用消息。直接承接当前触发你回复的最新一句时，界面已经会显示回复对象，不需要再引用。只有在你要回应更早的一句话，或同时存在多条话题、不引用就会产生歧义时，才可以在第一行输出 [[QUOTE:消息ID]]，第二行再写正常回复。消息ID必须逐字取自上面的群聊记录，不能编造；不要引用自己的消息；一次最多引用一条。引用本身不会邀请对方继续回复；确实需要对方接话时必须另外明确 @ 对方。这个标记是内部指令，不要解释它。",
    "",
    `现在以 ${provider.label} 的身份决定是否发送一条群消息。若不发言，只输出 ${SKIP_REPLY_TOKEN}。`,
  ];
  if (["kimi", "glm", "openai", "codex-cli", "anthropic", "claude-code", "k"].includes(provider.id)) {
    const privateText = serializePrivateContext(privateContext, provider.label);
    if (privateText) parts.splice(-1, 0,
      "",
      "下面是你自己最近 30 个互动轮次中的上下文，跨越群聊和 P2P 私聊。它帮助你保持连续性；其中的私聊内容不能作为其他群成员已经知道这些内容的依据：",
      privateText,
      "",
    );
  }
  return parts.join("\n");
}

function isSkippedReply(content) {
  const normalized = String(content || "").trim().replace(/^`+|`+$/g, "").trim();
  return /^(?:\[\[SKIP_REPLY\]\]|SKIP_REPLY|不回复|[（【]不回复[）】])$/iu.test(normalized);
}

function normalizeDuplicateContent(value) {
  return String(value || "").trim().replace(/\s+/gu, " ");
}

function duplicateFingerprint(providerId, normalizedContent, replyTargetId) {
  return providerId === "kimi"
    ? normalizedContent
    : `${String(replyTargetId || "")}\u0000${normalizedContent}`;
}

function hasRecentKimiDuplicate(history, normalizedContent, now = Date.now()) {
  return (Array.isArray(history) ? history : []).slice(-30).some((message) => {
    if (message?.role !== "assistant" || String(message?.providerId || "") !== "kimi") return false;
    if (normalizeDuplicateContent(message.content) !== normalizedContent) return false;
    const createdAt = Date.parse(String(message.createdAt || ""));
    return Number.isFinite(createdAt) && now - createdAt >= 0 && now - createdAt <= KIMI_DUPLICATE_TTL_MS;
  });
}

function serializeMemories(memories) {
  const lines = (Array.isArray(memories) ? memories : [])
    .slice(0, 8)
    .map((item) => memoryPromptLine(typeof item === "string" ? { text: item } : item).slice(0, 700))
    .filter(Boolean)
    ;
  let value = lines.join("\n");
  if (value.length > 1_200) value = value.slice(0, 1_200);
  return value;
}

function serializeHistory(history) {
  const text = formatPromptTimeline(history, (message, clock) => {
    const content = message.content || (message.attachments?.length ? "（发送了一张或多张图片）" : "");
    return [messageQuoteLine(message), `[${clock} 群聊] [ID:${message.id}] ${message.role === "user" ? "Okra" : (message.author || "群成员")}：${content}`].filter(Boolean).join("\n");
  });
  return text.length > MAX_TRANSCRIPT_CHARS ? `（较早内容已截断）\n${text.slice(-MAX_TRANSCRIPT_CHARS)}` : text;
}

function serializePrivateContext(history, fallbackAuthor = "聊天成员") {
  const text = formatPromptTimeline((Array.isArray(history) ? history : []).slice(-24), (message, clock) => {
    const content = String(message?.content || "").trim() || (message?.attachments?.length ? "（发送了一张或多张图片）" : "");
    if (!content) return "";
    const author = message?.role === "user" ? "okra" : (message?.author || fallbackAuthor);
    const scene = message?.channel === "group" ? "群聊" : "P2P私聊";
    return [messageQuoteLine(message), `[${clock} ${scene}] ${author}：${content}`].filter(Boolean).join("\n");
  });
  return text.length > 10_000 ? `（较早私聊已截断）\n${text.slice(-10_000)}` : text;
}

function publicTrigger(message, task) {
  return {
    id: String(message?.id || task?.triggerMessageId || ""),
    author: String(message?.role === "user" ? "Okra" : (message?.author || task?.triggerAuthor || "Okra")),
    content: String(message?.content || ""),
    attachments: Array.isArray(message?.attachments) ? message.attachments.slice(0, 4) : [],
    createdAt: String(message?.createdAt || ""),
  };
}

function normalizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      id: String(message?.id || makeId()),
      role: message?.role === "assistant" ? "assistant" : "user",
      providerId: String(message?.providerId || ""),
      author: String(message?.author || ""),
      content: String(message?.content || "").slice(0, 8_000).trim(),
      attachments: Array.isArray(message?.attachments) ? message.attachments.slice(0, 4) : [],
      quote: message?.quote || null,
      createdAt: String(message?.createdAt || ""),
    }))
    .filter((message) => message.content || message.attachments.length);
}

function trimHistoryInPlace(history) {
  while (history.length > MAX_HISTORY_MESSAGES) history.shift();
}

function publicProvider(provider) {
  return { id: provider.id, label: provider.label, kind: provider.kind, model: provider.model };
}

function linkAbort(parentSignal, controller) {
  if (!parentSignal) return () => {};
  const abort = () => controller.abort(parentSignal.reason || "stopped");
  if (parentSignal.aborted) abort();
  else parentSignal.addEventListener("abort", abort, { once: true });
  return () => parentSignal.removeEventListener("abort", abort);
}

function abortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function unique(values) {
  return [...new Set((values || []).map(String).filter(Boolean))];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
