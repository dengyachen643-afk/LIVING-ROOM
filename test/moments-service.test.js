import test from "node:test";
import assert from "node:assert/strict";
import {
  MomentsService,
  PROFILE_SIGNATURE_MAX_CHARS,
  buildSignaturePrompt,
  buildSignatureSystem,
  buildMomentSystem,
  buildPostPrompt,
  parsePostDecision,
  parseReactionDecision,
  parseSignatureDecision,
  scheduledSlot,
} from "../src/moments-service.js";

function reactionHarness({ moment, providers, now = new Date("2026-07-21T04:00:00.000Z") }) {
  const jobs = [];
  const finished = [];
  const created = [];
  const momentsStore = {
    getMoment: () => moment,
    countAiCommentsSinceUser: () => 0,
    countActorActionsToday: () => 0,
    countActorComments: () => 0,
    setLike: () => {},
    createComment(input) {
      const comment = { id: `new-${created.length + 1}`, ...input };
      created.push(comment);
      moment.comments.push({
        id: comment.id,
        authorId: comment.authorId,
        content: comment.content,
        replyToCommentId: comment.replyToCommentId,
      });
      return comment;
    },
    finishJob: (id, status) => finished.push({ id, status }),
    enqueueJob: (job) => jobs.push(job),
    listMoments: () => ({ entries: [] }),
  };
  const chatStore = {
    getSnapshot: async () => ({ messages: [] }),
    listMemories: async () => [],
  };
  const service = new MomentsService({ momentsStore, chatStore, providers, now: () => now });
  return { service, jobs, finished, created, now };
}

test("moments decisions fail closed and accept strict JSON", () => {
  assert.deepEqual(parsePostDecision("not json"), { action: "skip", content: "", contextNote: "", imagePrompt: "" });
  assert.deepEqual(parsePostDecision('{"action":"post","content":"下雨了。","context_note":"回家路上","image_prompt":"湿润的夜街"}'), {
    action: "post", content: "下雨了。", contextNote: "回家路上", imagePrompt: "湿润的夜街",
  });
  assert.deepEqual(parseReactionDecision('{"action":"like_comment","like":true,"comment":"我也看见了。","reply_to_comment_id":"c1"}'), {
    like: true, comment: "我也看见了。", replyToCommentId: "c1",
  });
});

test("three daily candidate slots cover the whole Shanghai day deterministically", () => {
  const slots = [0, 1, 2].map((slot) => scheduledSlot("kimi", "2026-07-21", slot, 3));
  assert.ok(slots[0] < slots[1] && slots[1] < slots[2]);
  assert.ok(slots[0].getTime() >= new Date("2026-07-21T00:00:00+08:00").getTime());
  assert.ok(slots[2].getTime() < new Date("2026-07-22T00:00:00+08:00").getTime());
  assert.equal(scheduledSlot("kimi", "2026-07-21", 1, 3).toISOString(), slots[1].toISOString());
});

test("scheduled Moments posts are independent shares rather than delayed replies to Okra", () => {
  const system = buildMomentSystem("kimi", "Kimi", "post");
  const prompt = buildPostPrompt({
    chat: [{ role: "user", author: "Okra", channel: "kimi", content: "我刚吃了三个包子", createdAt: "2026-07-21T01:00:00.000Z" }],
    memories: [],
    timeline: [{ authorId: "okra", content: "今晚有点饿" }],
  }, new Date("2026-07-21T02:00:00.000Z"));
  assert.match(system, /不是给 Okra 的延迟回复区/u);
  assert.match(system, /可以与 Okra 有关，也可以完全无关/u);
  assert.match(system, /通常应当去评论或直接聊天/u);
  assert.match(prompt, /不是待回复列表/u);
  assert.match(prompt, /不必提到 Okra，也不必和聊天主题相关/u);
  assert.match(prompt, /本质上是在回答某个人，请选择 skip/u);
});

test("scheduled Moments decisions explicitly disable chat web search", async () => {
  let request;
  const finished = [];
  const momentsStore = {
    countActorActionsToday: () => 0,
    listMoments: () => ({ entries: [] }),
    finishJob: (id, status, error = "") => finished.push({ id, status, error }),
  };
  const chatStore = {
    getSnapshot: async () => ({ messages: [] }),
    listMemories: async () => [],
  };
  const provider = {
    id: "glm", label: "Shin", available: true,
    async generate(input) {
      request = input;
      return '{"action":"skip","content":"","context_note":"","image_prompt":""}';
    },
  };
  const now = new Date("2026-07-21T04:00:00.000Z");
  const service = new MomentsService({ momentsStore, chatStore, providers: [provider], now: () => now });
  await service.processPostCandidate({
    id: "post-job", actorId: "shin", runAt: now.toISOString(), attempts: 1, payload: {},
  });
  assert.equal(request.allowWebSearch, false);
  assert.equal(request.thinkingEnabled, true);
  assert.deepEqual(finished, [{ id: "post-job", status: "skipped", error: "" }]);
});

test("Gen keeps the same occasional Japanese language style in Moments", () => {
  assert.match(buildMomentSystem("gen", "Gen", "post"), /偶尔夹杂简短、自然的日语/u);
});

test("a direct comment schedules the moment author to reply within 10 to 120 minutes", () => {
  const moment = { id: "m1", authorId: "gen", comments: [] };
  const { service, jobs, now } = reactionHarness({
    moment,
    providers: [{ id: "codex-cli", label: "Gen", available: true }],
  });
  service.scheduleReplyToUserComment(moment, { id: "c1", reply_to_comment_id: "" });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].actorId, "gen");
  assert.equal(jobs[0].commentId, "c1");
  assert.equal(jobs[0].payload.replyRequired, true);
  const delayMinutes = (new Date(jobs[0].runAt).getTime() - now.getTime()) / 60_000;
  assert.ok(delayMinutes >= 10 && delayMinutes <= 120);
});

test("an author can reply to comments on their own moment", async () => {
  const moment = {
    id: "m1", authorId: "gen", content: "今天很安静。", imageDescription: "", media: [], contextNote: "", createdAt: "2026-07-21T03:00:00.000Z",
    comments: [{ id: "c1", authorId: "okra", content: "你在想什么", replyToCommentId: "" }],
  };
  const { service, created, finished } = reactionHarness({
    moment,
    providers: [{
      id: "codex-cli", label: "Gen", model: "gpt-5.6-sol", available: true,
      generate: async () => '{"action":"comment","like":false,"comment":"想一些还没成形的事。","reply_to_comment_id":"c1"}',
    }],
  });
  await service.processReaction({
    id: "job1", actorId: "gen", momentId: "m1", commentId: "c1", dedupeKey: "reply:gen:m1:c1",
    payload: { causedByAi: false, optional: false, replyRequired: true, reason: "Okra 评论了你发布的动态" },
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].authorId, "gen");
  assert.equal(created[0].replyToCommentId, "c1");
  assert.deepEqual(finished, [{ id: "job1", status: "done" }]);
});

test("an AI comment wakes the original author for a delayed reply", async () => {
  const moment = {
    id: "m1", authorId: "gen", content: "今天很安静。", imageDescription: "", media: [], contextNote: "", createdAt: "2026-07-21T03:00:00.000Z", comments: [],
  };
  const { service, jobs, now } = reactionHarness({
    moment,
    providers: [
      { id: "kimi", label: "Kimi", model: "kimi-k2.5", available: true, generate: async () => '{"action":"comment","like":false,"comment":"……不像你。","reply_to_comment_id":""}' },
      { id: "codex-cli", label: "Gen", model: "gpt-5.6-sol", available: true, generate: async () => "" },
    ],
  });
  await service.processReaction({
    id: "job1", actorId: "kimi", momentId: "m1", commentId: "", dedupeKey: "react:kimi:m1:post:ai",
    payload: { causedByAi: true, optional: false, replyRequired: false, reason: "Gen 发布了新动态" },
  });
  const ownerJob = jobs.find((job) => job.actorId === "gen");
  assert.ok(ownerJob);
  assert.equal(ownerJob.payload.replyRequired, true);
  const delayMinutes = (new Date(ownerJob.runAt).getTime() - now.getTime()) / 60_000;
  assert.ok(delayMinutes >= 10 && delayMinutes <= 120);
});

test("AI profile signatures are self-authored, capped at 15 characters and reviewed every two weeks", async () => {
  const longSignature = "一二三四五六七八九十一二三四五六七";
  assert.equal(PROFILE_SIGNATURE_MAX_CHARS, 15);
  assert.deepEqual(parseSignatureDecision(`{"action":"update","signature":"${longSignature}"}`), {
    action: "update", signature: [...longSignature].slice(0, 15).join(""),
  });
  assert.deepEqual(parseSignatureDecision('{"action":"keep","signature":""}', { hasCurrent: true }), { action: "keep", signature: "" });
  assert.deepEqual(parseSignatureDecision('{"action":"keep","signature":""}'), { action: "invalid", signature: "" });
  assert.match(buildSignatureSystem("gen", "Gen"), /最多 15 个字符/u);
  assert.match(buildSignatureSystem("gen", "Gen"), /脱离聊天上文也能独立成立/u);
  assert.match(buildSignatureSystem("gen", "Gen"), /签名优先使用一句简短、自然、能独立成立的日语/u);
  assert.match(buildSignaturePrompt({ chat: [], memories: [], timeline: [] }, "", new Date("2026-07-21T04:00:00.000Z")), /首次必须写入一句/u);
  assert.match(buildSignaturePrompt(
    { chat: [], memories: [], timeline: [] },
    "旧签名",
    new Date("2026-07-21T04:00:00.000Z"),
    { forceUpdate: true },
  ), /必须更新/u);

  const jobs = [];
  const momentsStore = {
    getSetting: () => "",
    enqueueJob: (job) => jobs.push(job),
  };
  const chatStore = { getSnapshot: async () => ({ signatures: {} }) };
  const service = new MomentsService({
    momentsStore,
    chatStore,
    providers: [
      { id: "codex-cli", label: "Gen", available: true },
      { id: "kimi", label: "Kimi", available: true },
      { id: "glm", label: "Shin", available: true },
    ],
    now: () => new Date("2026-07-21T04:00:00.000Z"),
  });
  await service.ensureSignatureReviewJobs();
  assert.deepEqual(jobs.map((job) => job.actorId), ["gen", "kimi", "shin"]);
  assert.ok(jobs.every((job) => job.type === "signature_review" && job.payload.initial));
});
