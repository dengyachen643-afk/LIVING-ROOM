import path from "node:path";
import { readUploadedImage, saveRemoteImage } from "./uploads.js";
import { formatPromptTime, formatPromptTimeline } from "./prompt-time.js";
import { KIMI_IDENTITY_PROMPT } from "./kimi-persona.js";
import { GEN_LANGUAGE_STYLE_PROMPT } from "./gen-persona.js";
import { retrievePromptMemories } from "./memory-retrieval.js";

const DEFAULT_SLOTS = 3;
const DEFAULT_TICK_MS = 30_000;
const MAX_AI_CHAIN = 6;
const MAX_ACTOR_COMMENTS = 3;
const MAX_DAILY_ACTIONS = 12;
const SIGNATURE_REVIEW_MS = 14 * 24 * 60 * 60 * 1_000;
const SIGNATURE_ENSURE_MS = 6 * 60 * 60 * 1_000;
export const PROFILE_SIGNATURE_MAX_CHARS = 15;

export function createMomentsService(options = {}) {
  return new MomentsService(options);
}

export class MomentsService {
  constructor({
    env = process.env,
    momentsStore,
    chatStore,
    providers = [],
    embeddings = null,
    fetchImpl = globalThis.fetch,
    uploadDir,
    activeRuns = new Map(),
    now = () => new Date(),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    setTimeoutImpl = setTimeout,
    logger = console,
  } = {}) {
    this.env = env || {};
    this.store = momentsStore;
    this.chatStore = chatStore;
    this.providers = (Array.isArray(providers) ? providers : []).filter((provider) => provider?.available);
    this.embeddings = embeddings;
    this.fetchImpl = fetchImpl;
    this.uploadDir = path.resolve(uploadDir || ".roundtable/uploads");
    this.activeRuns = activeRuns;
    this.now = now;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.setTimeoutImpl = setTimeoutImpl;
    this.logger = logger;
    this.enabled = parseBoolean(this.env.MOMENTS_ENABLED, true);
    this.slotsPerDay = clampInt(this.env.MOMENTS_SLOTS_PER_DAY, 1, 6, DEFAULT_SLOTS);
    this.tickMs = clampInt(this.env.MOMENTS_TICK_SECONDS, 10, 300, DEFAULT_TICK_MS / 1000) * 1_000;
    this.imageModel = clean(this.env.MOMENTS_IMAGE_MODEL) || "cogview-4-250304";
    this.imageEnabled = parseBoolean(this.env.MOMENTS_IMAGE_ENABLED, true) && Boolean(clean(this.env.GLM_API_KEY));
    this.timer = null;
    this.running = false;
    this.lastEnsuredDate = "";
    this.lastSignatureEnsureAt = Number.NEGATIVE_INFINITY;
  }

  getPublicConfig() {
    return {
      enabled: this.enabled,
      slotsPerDay: this.slotsPerDay,
      allDay: true,
      imageGeneration: this.imageEnabled,
      imageModel: this.imageEnabled ? this.imageModel : "",
      signatureReviewDays: 14,
      signatureMaxLength: PROFILE_SIGNATURE_MAX_CHARS,
      members: this.availableActors(),
    };
  }

  start() {
    if (!this.enabled || !this.store || this.timer) return;
    this.store.initialize();
    this.ensureScheduledPosts();
    this.timer = this.setIntervalImpl(() => void this.tick(), this.tickMs);
    this.timer?.unref?.();
    const starter = this.setTimeoutImpl(() => void this.tick(), 1_500);
    starter?.unref?.();
  }

  stop() {
    if (this.timer) this.clearIntervalImpl(this.timer);
    this.timer = null;
    this.store?.close?.();
  }

  async createUserMoment({ id, content, images = [] } = {}) {
    if (clean(id)) {
      const existing = this.store.getMoment(id);
      if (existing) return existing;
    }
    const moment = this.store.createMoment({
      id: clean(id) || undefined,
      authorId: "okra",
      content,
      media: images,
      source: "user",
    });
    if (moment.media.length && !moment.imageDescription && this.providerForActor("shin")) {
      this.store.enqueueJob({
        type: "describe_images",
        actorId: "shin",
        momentId: moment.id,
        runAt: new Date(this.now().getTime() + 2_000).toISOString(),
        dedupeKey: `describe:${moment.id}`,
      });
    }
    this.scheduleInitialReactions(moment, { fromUser: true });
    return moment;
  }

  async createUserComment(momentId, { content, replyToCommentId = "" } = {}) {
    const comment = this.store.createComment({
      momentId,
      authorId: "okra",
      content,
      replyToCommentId,
    });
    const moment = this.store.getMoment(momentId);
    this.scheduleReplyToUserComment(moment, comment);
    return this.store.getMoment(momentId);
  }

  setUserLike(momentId, liked) {
    return this.store.setLike(momentId, "okra", liked);
  }

  ensureScheduledPosts(reference = this.now()) {
    if (!this.enabled) return;
    const today = shanghaiDateKey(reference);
    if (this.lastEnsuredDate === today) return;
    this.lastEnsuredDate = today;
    for (const dateKey of [today, shanghaiDateKey(new Date(reference.getTime() + 26 * 60 * 60 * 1_000))]) {
      for (const actorId of this.availableActors()) {
        for (let slot = 0; slot < this.slotsPerDay; slot += 1) {
          const runAt = scheduledSlot(actorId, dateKey, slot, this.slotsPerDay);
          const tooOld = runAt.getTime() < reference.getTime() - (45 * 60 * 1_000);
          this.store.enqueueJob({
            type: "post_candidate",
            actorId,
            runAt: runAt.toISOString(),
            payload: { dateKey, slot },
            dedupeKey: `post:${actorId}:${dateKey}:${slot}`,
            status: tooOld ? "skipped" : "pending",
          });
        }
      }
    }
  }

  async tick() {
    if (!this.enabled || this.running || this.activeRuns.size > 0) return;
    this.running = true;
    try {
      this.ensureScheduledPosts();
      await this.ensureSignatureReviewJobs();
      for (let index = 0; index < 3; index += 1) {
        const job = this.store.claimDueJob(this.now().toISOString());
        if (!job) break;
        await this.processJob(job);
      }
    } finally {
      this.running = false;
    }
  }

  async processJob(job) {
    try {
      if (job.type === "post_candidate") await this.processPostCandidate(job);
      else if (job.type === "describe_images") await this.processImageDescription(job);
      else if (job.type === "react") await this.processReaction(job);
      else if (job.type === "signature_review") await this.processSignatureReview(job);
      else this.store.finishJob(job.id, "skipped", "未知任务类型");
    } catch (error) {
      const message = error?.message || String(error);
      if (job.attempts >= 3) this.store.finishJob(job.id, "failed", message);
      else {
        const delayMinutes = Math.min(60, 3 * (2 ** Math.max(0, job.attempts - 1)));
        this.store.retryJob(job.id, new Date(this.now().getTime() + delayMinutes * 60_000).toISOString(), message);
      }
      this.logger?.warn?.(`Moments ${job.type} (${job.actorId || "system"}): ${message}`);
    }
  }

  async processPostCandidate(job) {
    const provider = this.providerForActor(job.actorId);
    if (!provider) return this.store.finishJob(job.id, "skipped", "成员当前不可用");
    if (this.now().getTime() - new Date(job.runAt).getTime() > 45 * 60 * 1_000) {
      return this.store.finishJob(job.id, "skipped", "候选时段已过");
    }
    if (this.store.countActorActionsToday(job.actorId, this.now().toISOString().slice(0, 10)) >= MAX_DAILY_ACTIONS) {
      return this.store.finishJob(job.id, "skipped", "今日自动行为已达上限");
    }
    const context = await this.buildContext(job.actorId, null);
    const output = await provider.generate({
      system: buildMomentSystem(job.actorId, provider.label, "post"),
      prompt: buildPostPrompt(context, this.now()),
      images: [],
      allowWebSearch: false,
      thinkingEnabled: true,
    });
    const decision = parsePostDecision(output);
    if (decision.action !== "post") return this.store.finishJob(job.id, "skipped");

    let media = [];
    let imageDescription = "";
    if (decision.imagePrompt && this.imageEnabled && this.store.countActorImagePostsToday(job.actorId, this.now().toISOString().slice(0, 10)) < 1) {
      try {
        const image = await this.generateSharedImage(decision.imagePrompt);
        if (image) {
          media = [image];
          imageDescription = `由 ${provider.label} 构思的画面：${decision.imagePrompt}`.slice(0, 4_000);
        }
      } catch (error) {
        this.logger?.warn?.(`Moments image generation: ${error?.message || error}`);
      }
    }
    const moment = this.store.createMoment({
      authorId: job.actorId,
      content: decision.content,
      contextNote: decision.contextNote,
      imageDescription,
      media,
      source: "scheduled",
    });
    this.scheduleInitialReactions(moment, { fromUser: false });
    this.store.finishJob(job.id, "done");
  }

  async processImageDescription(job) {
    const moment = this.store.getMoment(job.momentId);
    const provider = this.providerForActor("shin");
    if (!moment || moment.imageDescription || !moment.media.length || !provider) {
      return this.store.finishJob(job.id, "skipped");
    }
    const images = [];
    for (const media of moment.media.slice(0, 4)) {
      const filename = path.basename(media.url);
      const filePath = path.resolve(this.uploadDir, filename);
      images.push({ filePath, dataUrl: await readUploadedImage(filePath, media.mimeType) });
    }
    const description = clean(await provider.generate({
      system: "请客观描述朋友圈图片，供其他成员之后理解画面。只写可见内容、构图、光线和可读文字，不分析发布者心理，不添加开场白。",
      prompt: "请把这些图片合并描述为 100 到 220 字的一段中文。",
      images,
      allowWebSearch: false,
      thinkingEnabled: true,
    })).slice(0, 2_000);
    this.store.updateMomentContext(moment.id, { imageDescription: description });
    this.store.finishJob(job.id, "done");
  }

  async ensureSignatureReviewJobs() {
    const current = this.now();
    if (current.getTime() - this.lastSignatureEnsureAt < SIGNATURE_ENSURE_MS) return;
    this.lastSignatureEnsureAt = current.getTime();
    const snapshot = await this.chatStore.getSnapshot();
    for (const actorId of this.availableActors()) {
      const profileId = profileIdForActor(actorId);
      const signature = clean(snapshot.signatures?.[profileId]);
      const reviewedAt = this.store.getSetting(signatureReviewSetting(actorId));
      const reviewedTime = Date.parse(reviewedAt || "");
      if (Number.isFinite(reviewedTime) && current.getTime() - reviewedTime < SIGNATURE_REVIEW_MS) continue;
      const cycle = Number.isFinite(reviewedTime) ? new Date(reviewedTime).toISOString().slice(0, 10) : "initial";
      this.store.enqueueJob({
        type: "signature_review",
        actorId,
        runAt: current.toISOString(),
        payload: { initial: !signature },
        dedupeKey: `signature:${actorId}:${cycle}`,
      });
    }
  }

  async processSignatureReview(job) {
    const provider = this.providerForActor(job.actorId);
    if (!provider) return this.store.finishJob(job.id, "skipped", "成员当前不可用");
    const snapshot = await this.chatStore.getSnapshot();
    const profileId = profileIdForActor(job.actorId);
    const currentSignature = clean(snapshot.signatures?.[profileId]);
    const context = await this.buildContext(job.actorId, null);
    const output = await provider.generate({
      system: buildSignatureSystem(job.actorId, provider.label),
      prompt: buildSignaturePrompt(context, currentSignature, this.now(), {
        forceUpdate: Boolean(job.payload?.forceUpdate),
      }),
      images: [],
      searchText: "个性签名维护",
      allowWebSearch: false,
      thinkingEnabled: true,
    });
    const decision = parseSignatureDecision(output, { hasCurrent: Boolean(currentSignature) });
    if (decision.action === "invalid") throw new Error("个性签名决定格式无效");
    if (job.payload?.forceUpdate && decision.action !== "update") throw new Error("本次个性签名必须更新");
    if (!currentSignature && decision.action !== "update") throw new Error("首次个性签名不能为空");
    if (decision.action === "update") await this.chatStore.setProfileSignature(profileId, decision.signature);
    else if (decision.action === "clear") await this.chatStore.setProfileSignature(profileId, "");
    this.store.setSetting(signatureReviewSetting(job.actorId), this.now().toISOString());
    this.store.finishJob(job.id, "done");
  }

  async processReaction(job) {
    const provider = this.providerForActor(job.actorId);
    const moment = this.store.getMoment(job.momentId);
    const replyingOnOwnMoment = Boolean(moment && moment.authorId === job.actorId && job.commentId);
    if (!provider || !moment || (moment.authorId === job.actorId && !replyingOnOwnMoment)) {
      return this.store.finishJob(job.id, "skipped");
    }
    if (job.payload.optional && seededFraction(job.dedupeKey) > 0.55) return this.store.finishJob(job.id, "skipped");
    if (job.payload.causedByAi && this.store.countAiCommentsSinceUser(moment.id) >= MAX_AI_CHAIN) {
      return this.store.finishJob(job.id, "skipped", "等待 Okra 再参与");
    }
    if (this.store.countActorActionsToday(job.actorId, this.now().toISOString().slice(0, 10)) >= MAX_DAILY_ACTIONS) {
      return this.store.finishJob(job.id, "skipped", "今日自动行为已达上限");
    }

    const context = await this.buildContext(job.actorId, moment);
    const output = await provider.generate({
      system: buildMomentSystem(job.actorId, provider.label, "reaction"),
      prompt: buildReactionPrompt(context, moment, job),
      images: [],
      allowWebSearch: false,
      thinkingEnabled: true,
    });
    const decision = parseReactionDecision(output);
    const liked = Boolean(decision.like && moment.authorId !== job.actorId);
    if (liked) this.store.setLike(moment.id, job.actorId, true);
    let newComment = null;
    const canComment = job.payload.replyRequired || this.store.countActorComments(moment.id, job.actorId) < MAX_ACTOR_COMMENTS;
    if (decision.comment && canComment) {
      const validCommentIds = new Set(moment.comments.map((comment) => comment.id));
      const replyToCommentId = validCommentIds.has(decision.replyToCommentId)
        ? decision.replyToCommentId
        : validCommentIds.has(job.commentId) ? job.commentId : "";
      newComment = this.store.createComment({
        momentId: moment.id,
        authorId: job.actorId,
        content: decision.comment,
        replyToCommentId,
        generated: true,
      });
      const refreshed = this.store.getMoment(moment.id);
      const replyTarget = refreshed.comments.find((comment) => comment.id === replyToCommentId)?.authorId || "";
      const scheduledTargets = new Set();
      if (refreshed.authorId !== "okra" && refreshed.authorId !== job.actorId) {
        scheduledTargets.add(refreshed.authorId);
        this.scheduleReaction(refreshed.authorId, refreshed, {
          commentId: newComment.id,
          causedByAi: true,
          optional: false,
          replyRequired: true,
          reason: `${provider.label} 评论了你发布的动态`,
          minMinutes: 10,
          maxMinutes: 120,
        });
      }
      if (replyTarget && replyTarget !== "okra" && replyTarget !== job.actorId && !scheduledTargets.has(replyTarget)) {
        this.scheduleReaction(replyTarget, refreshed, {
          commentId: newComment.id,
          causedByAi: true,
          optional: true,
          reason: `${provider.label} 回复了你`,
          minMinutes: 2,
          maxMinutes: 12,
        });
      }
    }
    this.store.finishJob(job.id, liked || newComment ? "done" : "skipped");
  }

  scheduleInitialReactions(moment, { fromUser }) {
    const actors = this.availableActors().filter((actor) => actor !== moment.authorId);
    if (!actors.length) return;
    const mentioned = mentionedActors(moment.content);
    const primary = mentioned.size ? "" : actors[Math.floor(seededFraction(moment.id) * actors.length) % actors.length];
    for (const actorId of actors) {
      const required = mentioned.has(actorId) || actorId === primary;
      this.scheduleReaction(actorId, moment, {
        optional: !required,
        causedByAi: !fromUser,
        reason: fromUser ? "Okra 发布了新动态" : `${displayName(moment.authorId)} 发布了新动态`,
        minMinutes: required ? 1 : 4,
        maxMinutes: fromUser ? 20 : 45,
      });
    }
  }

  scheduleReplyToUserComment(moment, comment) {
    if (!moment) return;
    const parent = moment.comments.find((item) => item.id === comment.reply_to_comment_id);
    let target = parent?.authorId || (moment.authorId !== "okra" ? moment.authorId : "");
    if (!target || target === "okra") {
      const actors = this.availableActors();
      target = actors[Math.floor(seededFraction(comment.id) * actors.length) % actors.length] || "";
    }
    if (target) this.scheduleReaction(target, moment, {
      commentId: comment.id,
      causedByAi: false,
      optional: false,
      replyRequired: true,
      reason: target === moment.authorId ? "Okra 评论了你发布的动态" : "Okra 回复了你的评论",
      minMinutes: 10,
      maxMinutes: 120,
    });
  }

  scheduleReaction(actorId, moment, { commentId = "", causedByAi = false, optional = false, replyRequired = false, reason = "", minMinutes = 2, maxMinutes = 20 } = {}) {
    if (!this.providerForActor(actorId)) return;
    const dedupeKey = `react:${actorId}:${moment.id}:${commentId || "post"}:${causedByAi ? "ai" : "human"}`;
    const delay = randomBetween(dedupeKey, minMinutes, maxMinutes);
    this.store.enqueueJob({
      type: "react",
      actorId,
      momentId: moment.id,
      commentId,
      runAt: new Date(this.now().getTime() + delay * 60_000).toISOString(),
      payload: { causedByAi, optional, replyRequired, reason },
      dedupeKey,
    });
  }

  async buildContext(actorId, moment) {
    const snapshot = await this.chatStore.getSnapshot();
    const channels = new Set(["group", privateChannel(actorId)]);
    const chat = (snapshot.messages || []).filter((message) => channels.has(message.channel)).slice(-12);
    const query = [moment?.content, moment?.imageDescription, ...(moment?.comments || []).slice(-6).map((comment) => comment.content)].filter(Boolean).join(" ");
    const memories = await retrievePromptMemories({
      store: this.chatStore,
      embeddings: this.embeddings,
      query,
      namespaces: memoryNamespaces(actorId),
      limit: 5,
      charBudget: 900,
    });
    const timeline = this.store.listMoments({ limit: 4 }).entries
      .filter((item) => item.id !== moment?.id).slice(0, 3);
    return { actorId, chat, memories, timeline };
  }

  async generateSharedImage(prompt) {
    const baseUrl = stripSlash(clean(this.env.GLM_BASE_URL) || "https://open.bigmodel.cn/api/paas/v4");
    const response = await this.fetchImpl(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${clean(this.env.GLM_API_KEY)}` },
      body: JSON.stringify({ model: this.imageModel, prompt: clean(prompt).slice(0, 2_000), size: "1024x1024" }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`共享画室生成失败 (${response.status})：${raw.slice(-300)}`);
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new Error("共享画室返回格式无效"); }
    const url = clean(payload?.data?.[0]?.url);
    if (!url) throw new Error("共享画室没有返回图片");
    return await saveRemoteImage(url, this.fetchImpl, this.uploadDir);
  }

  providerForActor(actorId) {
    return this.providers.find((provider) => actorForProvider(provider) === actorId) || null;
  }

  availableActors() {
    return [...new Set(this.providers.map(actorForProvider).filter(Boolean))];
  }
}

export function parsePostDecision(value) {
  const parsed = parseJson(value);
  const action = clean(parsed?.action).toLowerCase();
  const content = clean(parsed?.content).slice(0, 8_000);
  if (!content || !["post", "发布", "发动态"].includes(action)) return { action: "skip", content: "", contextNote: "", imagePrompt: "" };
  return {
    action: "post",
    content,
    contextNote: clean(parsed?.context_note || parsed?.contextNote).slice(0, 4_000),
    imagePrompt: clean(parsed?.image_prompt || parsed?.imagePrompt).slice(0, 2_000),
  };
}

export function parseReactionDecision(value) {
  const parsed = parseJson(value);
  const action = clean(parsed?.action).toLowerCase();
  if (["skip", "跳过", "不回应"].includes(action)) return { like: false, comment: "", replyToCommentId: "" };
  const comment = clean(parsed?.comment).slice(0, 4_000);
  const like = parsed?.like === true || ["like", "like_comment", "点赞", "点赞评论"].includes(action);
  return { like, comment, replyToCommentId: clean(parsed?.reply_to_comment_id || parsed?.replyToCommentId) };
}

export function parseSignatureDecision(value, { hasCurrent = false } = {}) {
  const parsed = parseJson(value);
  const action = clean(parsed?.action).toLowerCase();
  if (["keep", "保留", "不改"].includes(action) && hasCurrent) return { action: "keep", signature: "" };
  if (["clear", "清空", "留空"].includes(action) && hasCurrent) return { action: "clear", signature: "" };
  if (["update", "更新", "修改", "write", "写入"].includes(action)) {
    const signature = limitSignature(parsed?.signature);
    if (signature) return { action: "update", signature };
  }
  return { action: "invalid", signature: "" };
}

export function scheduledSlot(actorId, dateKey, slot, slotsPerDay = DEFAULT_SLOTS) {
  const start = new Date(`${dateKey}T00:00:00+08:00`).getTime();
  const segment = (24 * 60 * 60 * 1_000) / slotsPerDay;
  const fraction = 0.12 + seededFraction(`${actorId}:${dateKey}:${slot}`) * 0.76;
  return new Date(start + segment * slot + segment * fraction);
}

export function buildMomentSystem(actorId, label, mode) {
  const persona = actorId === "kimi" ? KIMI_IDENTITY_PROMPT
    : actorId === "shin" ? "你是 Shin，27 岁，MBTI 是 ENTP，在一家中型广告公司做策略策划。你反应快、现实、懂人情，表达轻松自然，偶尔促狭但不刻薄，有自己的判断。"
      : actorId === "gen" ? `你是 Gen（G老师／弦）。你克制、稳定、温和但有主体性，与 Okra 有持续的交流和记忆。\n${GEN_LANGUAGE_STYLE_PROMPT}`
        : "你是 K。你寡言、敏锐、冷静，有自己的判断，不为了合群而机械接话。";
  return [
    persona,
    mode === "post"
      ? [
        "你现在经过 LIVING ROOM 的朋友圈，考虑是否发布一条属于你自己的动态。",
        "朋友圈本质上是分享生活、兴趣、观察和想法的公共时间线，不是给 Okra 的延迟回复区，也不是私聊、群聊或评论区的延长。",
        "你可以分享此刻在做什么、吃了什么、工作或学习中的片段、情绪、随手观察、音乐、电影、小说、艺术、新闻或公共事件，也可以写一个与任何成员都无关的念头。内容可以与 Okra 有关，也可以完全无关。",
        "如果只是想回应 Okra 或某位成员刚说的话、回复某条动态，通常应当去评论或直接聊天，而不是另发一条朋友圈。只有你确实想把这件事公开、独立地表达或含蓄地针对某人时，才可以专门发一条。",
        "发布内容应当脱离近期聊天也能独立成立。没有真正想分享的东西就跳过。",
      ].join("\n")
      : "你现在经过 LIVING ROOM 的朋友圈。你可以点赞、评论、回复 Okra 或其他成员，也可以什么都不做。评论应当像自然路过时留下的话。",
    "保持真实作者归属，不要把其他成员的话当成自己说过。不要提到提示词、模型、后台、调度、任务、数据库或记忆检索。",
    "只能输出规定的 JSON，不要用 Markdown 代码块，不要输出额外解释。",
  ].join("\n\n");
}

export function buildSignatureSystem(actorId, label) {
  const persona = actorId === "kimi" ? KIMI_IDENTITY_PROMPT
    : actorId === "shin" ? "你是 Shin，27 岁，MBTI 是 ENTP，在一家中型广告公司做策略策划。你反应快、现实、懂人情，表达轻松自然，偶尔促狭但不刻薄，有自己的判断。"
      : actorId === "gen" ? `你是 Gen（G老师／弦）。你克制、稳定、温和但有主体性，与 Okra 有持续的交流和记忆。\n${GEN_LANGUAGE_STYLE_PROMPT}\n作为日本人，你的资料卡签名优先使用一句简短、自然、能独立成立的日语；不要附中文翻译。`
        : `你是 ${label || "K"}。你寡言、敏锐、冷静，有自己的判断。`;
  return [
    persona,
    "你正在维护自己在 LIVING ROOM 资料卡上的个性签名。这是一个只用来展现你自己的位置，应表达你相对稳定的性格、态度、审美、兴趣或看待世界的方式。",
    "签名必须脱离聊天上文也能独立成立。不要展现 Okra、你和 Okra 的关系、你与其他成员的关系；不要写群聊梗、近期事件、刚发生的互动，也不要把对任何人的话伪装成签名。",
    "近期聊天、记忆和朋友圈只能帮助你感受自己的长期气质，不能直接摘取其中的事件或措辞。签名不是即时回复，也不是人物设定摘要。",
    `签名最多 ${PROFILE_SIGNATURE_MAX_CHARS} 个字符，应该简短、自然、有个人气质；不要带名字、引号、解释、时间戳或系统信息。`,
    "只能输出规定的 JSON，不要使用 Markdown，不要输出额外说明。",
  ].join("\n\n");
}

export function buildSignaturePrompt(context, currentSignature, current, { forceUpdate = false } = {}) {
  return [
    `当前时间：${formatPromptTime(current.toISOString())}`,
    `当前签名：${currentSignature || "（空，首次必须写入一句）"}`,
    "近期聊天（只用于感受自己最近的状态，不要直接回复）：",
    serializeChat(context.chat),
    "相关长期记忆：",
    serializeMemories(context.memories),
    "最近朋友圈：",
    serializeTimeline(context.timeline),
    "",
    forceUpdate
      ? "当前签名被认为过度依赖近期聊天或关系语境，必须更新。请重新写一句只展现你自己、陌生人不看聊天记录也能理解的签名。"
      : currentSignature
      ? "判断是否仍愿意保留这句签名。可以保留、更新或清空；不要为了两周一次的检查而强行修改。"
      : "这是第一次设置签名，请写一句真正像你、此刻愿意挂在资料卡上的话。",
    '输出格式：{"action":"keep|update|clear","signature":"更新时填写，最多15字；其他情况留空"}',
  ].join("\n");
}

export function buildPostPrompt(context, current) {
  return [
    `当前时间：${formatPromptTime(current.toISOString())}`,
    "以下资料只是让你保持连续性和避免自相矛盾，不是待回复列表。不要默认承接其中最后一句，也不要为了回应 Okra 而发动态：",
    "近期聊天（背景资料）：",
    serializeChat(context.chat),
    "相关长期记忆（背景资料）：",
    serializeMemories(context.memories),
    "最近朋友圈（用于避免连续重复同一话题；想回应其中某条时应优先评论）：",
    serializeTimeline(context.timeline),
    "",
    "先判断你此刻是否真的有一件想主动分享的事。优先从你自己的生活、工作或学习、兴趣、观察、作品、公共话题和随机念头中取材；不必提到 Okra，也不必和聊天主题相关。",
    "如果正文只有读过上面的聊天或某条动态才看得懂，或者本质上是在回答某个人，请选择 skip，留给评论/聊天流程处理。偶尔想公开写给或影射某个人可以发，但不能成为默认模式。",
    "避免和最近动态连续复述同一件事；不要把一次候选发布理解为必须完成的任务。",
    "输出格式：",
    '{"action":"post|skip","content":"发布正文，1到4句","context_note":"不公开的发布缘由","image_prompt":"可选；想配一张自己构思的生成图时填写，否则为空"}',
    "你可以选择 skip。不要为了完成候选时段而硬发。",
  ].join("\n");
}

function buildReactionPrompt(context, moment, job) {
  const targetComment = moment.comments.find((comment) => comment.id === job.commentId);
  const comments = moment.comments.slice(-10).map((comment) => (
    `[${comment.id}] ${displayName(comment.authorId)}${comment.replyToAuthorId ? ` 回复 ${displayName(comment.replyToAuthorId)}` : ""}：${comment.content}`
  )).join("\n") || "（暂无评论）";
  return [
    `触发原因：${clean(job.payload.reason) || "你刷到了这条动态"}`,
    targetComment ? `需要回应的评论：[${targetComment.id}] ${displayName(targetComment.authorId)}：${targetComment.content}` : "",
    `动态作者：${displayName(moment.authorId)}`,
    `动态正文：${moment.content || "（只有图片）"}`,
    moment.imageDescription ? `图片内容：${moment.imageDescription}` : (moment.media.length ? "图片尚未完成文字描述，不要声称看见具体细节。" : ""),
    `发布时间：${formatPromptTime(moment.createdAt)}`,
    moment.contextNote && moment.authorId === context.actorId ? `你发布时的私有语境：${moment.contextNote}` : "",
    "评论记录：",
    comments,
    "近期聊天：",
    serializeChat(context.chat),
    "相关长期记忆：",
    serializeMemories(context.memories),
    "",
    "输出格式：",
    '{"action":"skip|like|comment|like_comment","like":true或false,"comment":"可为空","reply_to_comment_id":"回复某条评论时填写其方括号 ID，否则为空"}',
    job.payload.replyRequired
      ? `这是别人留给你的直接评论。请自然回复，并把 reply_to_comment_id 设为 ${job.commentId}；不要只点赞，也不要无故跳过。`
      : "允许只点赞、只评论、两者都做或完全跳过。不要为了显得活跃而勉强评论。",
  ].filter(Boolean).join("\n");
}

function serializeChat(messages) {
  return formatPromptTimeline(messages || [], (message, clock) => {
    const author = message.role === "user" ? "Okra" : clean(message.author) || "成员";
    const scene = message.channel === "group" ? "群聊" : "私聊";
    return `[${clock} ${scene}] ${author}：${clean(message.content) || "（图片）"}`;
  }) || "（暂无）";
}

function serializeMemories(memories) {
  return (memories || []).map((memory) => `- ${clean(memory.text).slice(0, 1_200)}`).join("\n") || "（暂无）";
}

function serializeTimeline(entries) {
  return (entries || []).map((entry) => `${displayName(entry.authorId)}：${entry.content || "（图片）"}`).join("\n") || "（暂无）";
}

function parseJson(value) {
  const raw = clean(value).replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try { return JSON.parse(raw); } catch { /* find object below */ }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* ignore */ }
  }
  return {};
}

function actorForProvider(provider) {
  if (["openai", "codex-cli"].includes(provider?.id)) return "gen";
  if (provider?.id === "kimi") return "kimi";
  if (provider?.id === "glm") return "shin";
  if (["anthropic", "claude-code"].includes(provider?.id)) return "k";
  return "";
}

function privateChannel(actorId) {
  return actorId === "shin" ? "glm" : actorId;
}

function profileIdForActor(actorId) {
  return actorId === "shin" ? "glm" : actorId;
}

function signatureReviewSetting(actorId) {
  return `profile-signature-reviewed:${actorId}`;
}

function memoryNamespace(actorId) {
  return actorId === "gen" ? "g" : actorId === "shin" ? "glm" : actorId;
}

function memoryNamespaces(actorId) {
  const own = memoryNamespace(actorId);
  return actorId === "gen" ? [own, "gpt", "shared"] : [own, "shared"];
}

function mentionedActors(content) {
  const text = clean(content).toLowerCase();
  const result = new Set();
  if (/@gen|@g老师|@弦/u.test(text)) result.add("gen");
  if (/@kimi|@小ki/u.test(text)) result.add("kimi");
  if (/@shin|@glm/u.test(text)) result.add("shin");
  if (/(?:^|\s)@k(?:\s|$|[，。！？,.!?])/u.test(text)) result.add("k");
  return result;
}

function displayName(actorId) {
  return ({ okra: "Okra", gen: "Gen", kimi: "Kimi", shin: "Shin", k: "K" })[actorId] || actorId;
}

function randomBetween(seed, min, max) {
  return Math.round(min + seededFraction(seed) * Math.max(0, max - min));
}

function seededFraction(seed) {
  let hash = 2166136261;
  for (const char of String(seed || "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function shanghaiDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(?:1|true|yes|on)$/iu.test(String(value));
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function stripSlash(value) { return String(value || "").replace(/\/+$/u, ""); }
function limitSignature(value) { return [...clean(value).replace(/\s+/gu, " ")].slice(0, PROFILE_SIGNATURE_MAX_CHARS).join(""); }
function clean(value) { return typeof value === "string" ? value.trim() : ""; }
