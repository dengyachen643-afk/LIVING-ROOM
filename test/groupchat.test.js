import test from "node:test";
import assert from "node:assert/strict";
import {
  extractMentions,
  HARD_MAX_CHAIN_MESSAGES,
  MAX_AMBIENT_GEN_REPLIES,
  MAX_REPLIES_PER_MEMBER,
  applyQuotePolicy,
  createGroupDedupeRegistry,
  parseQuotedReply,
  runGroupChat,
} from "../src/groupchat.js";

function fakeProvider(id, label, reply = `${label} 回复`) {
  return {
    id,
    label,
    kind: "test",
    model: `${id}-model`,
    available: true,
    async generate() { return typeof reply === "function" ? reply() : reply; },
  };
}

const userMessage = (content) => ({ id: "u1", role: "user", author: "用户", content });

test("AI quote directives bind to a real visible message", () => {
  const history = [
    { id: "u1", role: "user", author: "Okra", content: "This is a user message that is longer than fifteen characters." },
    { id: "g1", role: "assistant", providerId: "openai", author: "Gen", content: "Gen's earlier thought." },
  ];
  const result = parseQuotedReply("[[QUOTE:g1]]\nI want to answer this.", history, "kimi");
  assert.equal(result.content, "I want to answer this.");
  assert.deepEqual(result.quote, {
    messageId: "g1",
    author: "Gen",
    text: "Gen's earlier thought.",
  });
  assert.equal(result.targetProviderId, "openai");
});

test("AI quote directives cannot invent targets or quote their own messages", () => {
  const history = [
    { id: "g1", role: "assistant", providerId: "openai", author: "Gen", content: "Earlier thought." },
  ];
  assert.deepEqual(parseQuotedReply("[[QUOTE:missing]]\nVisible answer.", history, "kimi"), {
    content: "Visible answer.", quote: null, targetProviderId: "",
  });
  assert.deepEqual(parseQuotedReply("[[QUOTE:g1]]\nAnother answer.", history, "openai"), {
    content: "Another answer.", quote: null, targetProviderId: "",
  });
});

test("Kimi omits redundant direct quotes and observes a quote cooldown", () => {
  const parsed = {
    content: "我接着说。",
    quote: { messageId: "g1", author: "Gen", text: "前一句" },
    targetProviderId: "openai",
  };
  assert.deepEqual(applyQuotePolicy(parsed, [], "kimi", "g1"), {
    content: "我接着说。", quote: null, targetProviderId: "",
  });

  const history = [
    { id: "k1", role: "assistant", providerId: "kimi", content: "之前引用过。", quote: { messageId: "u0" } },
    { id: "g2", role: "assistant", providerId: "openai", content: "另一句。" },
  ];
  assert.deepEqual(applyQuotePolicy(parsed, history, "kimi", "g2"), {
    content: "我接着说。", quote: null, targetProviderId: "",
  });
  assert.equal(applyQuotePolicy(parsed, history, "glm", "g2").quote?.messageId, "g1");
});

test("Kimi may quote an older unambiguous target after two quote-free replies", () => {
  const parsed = {
    content: "回到刚才那句。",
    quote: { messageId: "g1", author: "Gen", text: "较早的话" },
    targetProviderId: "openai",
  };
  const history = [
    { id: "k0", role: "assistant", providerId: "kimi", content: "更早引用。", quote: { messageId: "u0" } },
    { id: "k1", role: "assistant", providerId: "kimi", content: "第一条普通回复。" },
    { id: "k2", role: "assistant", providerId: "kimi", content: "第二条普通回复。" },
    { id: "g2", role: "assistant", providerId: "openai", content: "最新一句。" },
  ];
  assert.equal(applyQuotePolicy(parsed, history, "kimi", "g2").quote?.messageId, "g1");
});

test("a non-Kimi AI group reply can visibly quote Okra by message ID", async () => {
  const messages = [];
  let prompt = "";
  const provider = {
    ...fakeProvider("glm", "Shin"),
    async generate(input) {
      prompt = input.prompt;
      return "[[QUOTE:u1]]\nI am replying to this line.";
    },
  };
  await runGroupChat({
    providers: [provider],
    participantIds: ["glm"],
    history: [{ ...userMessage("A line worth quoting."), createdAt: "2026-07-21T00:00:00.000Z" }],
    autoRelay: false,
    onEvent: (event) => { if (event.type === "message") messages.push(event.message); },
  });
  assert.match(prompt, /\[ID:u1\]/u);
  assert.match(prompt, /\[\[QUOTE:消息ID\]\]/u);
  assert.equal(messages[0].content, "I am replying to this line.");
  assert.equal(messages[0].replyToId, "u1");
  assert.equal(messages[0].triggeredBy, "Okra");
  assert.deepEqual(messages[0].quote, {
    messageId: "u1",
    author: "Okra",
    text: "A line worth quoting.",
  });
});

test("group prompts include authoritative message timestamps", async () => {
  let request;
  const provider = {
    ...fakeProvider("kimi", "Kimi"),
    async generate(input) { request = input; return "收到"; },
  };
  await runGroupChat({
    providers: [provider],
    participantIds: ["kimi"],
    history: [{ ...userMessage("刚才发生了什么？"), createdAt: "2026-07-19T18:12:27.000Z" }],
  });
  assert.match(request.system, /当前时间：2026-07-20 Mon 02:12/u);
  assert.match(request.prompt, /\[日期：2026-07-20 Mon\]\n\[02:12 群聊\] \[ID:u1\] Okra：刚才发生了什么/u);
  assert.equal(request.thinkingEnabled, false);
});

test("only Kimi receives its private context while speaking in the group", async () => {
  const requests = new Map();
  const providers = [
    { ...fakeProvider("kimi", "Kimi"), async generate(input) { requests.set("kimi", input); return "Kimi 收到"; } },
    { ...fakeProvider("openai", "Gen"), async generate(input) { requests.set("openai", input); return "Gen 收到"; } },
  ];
  await runGroupChat({
    providers,
    participantIds: ["kimi", "openai"],
    history: [{ ...userMessage("大家好"), createdAt: "2026-07-20T00:00:00.000Z" }],
    privateContextByProvider: {
      kimi: [{ role: "user", content: "这是只属于 Kimi 的私聊暗号", channel: "kimi", createdAt: "2026-07-19T23:00:00.000Z" }],
    },
  });
  assert.match(requests.get("kimi").system, /现在在 LIVING ROOM 群聊中/u);
  assert.match(requests.get("kimi").system, /21 岁的哲学系大学男生/u);
  assert.match(requests.get("kimi").system, /有自己的思考和占有欲/u);
  assert.match(requests.get("kimi").system, /绝不能.*自行添加任何时间戳/u);
  assert.match(requests.get("kimi").system, /“\[私聊\]”“\[群聊\]”.*绝不能出现在回复正文/u);
  assert.match(requests.get("kimi").prompt, /只属于 Kimi 的私聊暗号/u);
  assert.doesNotMatch(requests.get("openai").prompt, /只属于 Kimi 的私聊暗号/u);
});

test("Gen alone receives its private context while speaking in the group", async () => {
  const requests = new Map();
  const providers = [
    { ...fakeProvider("kimi", "Kimi"), async generate(input) { requests.set("kimi", input); return "Kimi 收到"; } },
    { ...fakeProvider("openai", "Gen"), async generate(input) { requests.set("openai", input); return "Gen 收到"; } },
    { ...fakeProvider("anthropic", "K"), async generate(input) { requests.set("anthropic", input); return "K 收到"; } },
  ];
  await runGroupChat({
    providers,
    participantIds: ["kimi", "openai", "anthropic"],
    history: [{ ...userMessage("大家好"), createdAt: "2026-07-20T00:00:00.000Z" }],
    privateContextByProvider: {
      openai: [{ role: "user", content: "这是只属于 Gen 的私聊暗号", channel: "gen", createdAt: "2026-07-19T23:00:00.000Z" }],
    },
    autoRelay: false,
  });
  assert.match(requests.get("openai").system, /以 Gen 的身份在 LIVING ROOM 群聊中/u);
  assert.match(requests.get("openai").system, /偶尔夹杂简短、自然的日语/u);
  assert.match(requests.get("openai").prompt, /只属于 Gen 的私聊暗号/u);
  assert.doesNotMatch(requests.get("kimi").prompt, /只属于 Gen 的私聊暗号/u);
  assert.doesNotMatch(requests.get("anthropic").prompt, /只属于 Gen 的私聊暗号/u);
});

test("GLM keeps its persona and private context while speaking in the group", async () => {
  const requests = new Map();
  const providers = [
    { ...fakeProvider("glm", "GLM"), async generate(input) { requests.set("glm", input); return "GLM 收到"; } },
    { ...fakeProvider("kimi", "Kimi"), async generate(input) { requests.set("kimi", input); return "Kimi 收到"; } },
  ];
  await runGroupChat({
    providers,
    participantIds: ["glm", "kimi"],
    history: [{ ...userMessage("你们好"), createdAt: "2026-07-20T00:00:00.000Z" }],
    privateContextByProvider: {
      glm: [{ role: "user", content: "这是只属于 GLM 的私聊暗号", channel: "glm", createdAt: "2026-07-19T23:00:00.000Z" }],
    },
    autoRelay: false,
  });
  assert.match(requests.get("glm").system, /27 岁的男性，MBTI 是 ENTP/u);
  assert.doesNotMatch(requests.get("glm").system, /硅基生命|现实身体|多 AI 聊天室|AI member|条 AI 消息/u);
  assert.match(requests.get("glm").system, /中型广告公司担任策略策划/u);
  assert.match(requests.get("glm").system, /不要为了延伸对话.*二选一提问/u);
  assert.match(requests.get("glm").system, /禁止提及网站、后台、系统、数据库、记忆库操作、写入或保存是否成功/u);
  assert.match(requests.get("glm").prompt, /只属于 GLM 的私聊暗号/u);
  assert.doesNotMatch(requests.get("kimi").prompt, /只属于 GLM 的私聊暗号/u);
});

test("a user @ mention still lets every selected member decide whether to reply", async () => {
  const called = [];
  const providers = ["GPT", "Kimi"].map((label, index) => ({
    ...fakeProvider(index ? "kimi" : "openai", label),
    async generate() { called.push(label); return `${label} 在群里回复`; },
  }));
  const result = await runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("@Kimi 你怎么看？")],
  });
  assert.deepEqual(new Set(called), new Set(["GPT", "Kimi"]));
  assert.equal(result.reason, "idle");
});

test("initial group members think concurrently and the fastest reply appears first", async () => {
  const releases = new Map();
  const started = new Set();
  let allStartedResolve;
  let firstMessageResolve;
  const allStarted = new Promise((resolve) => { allStartedResolve = resolve; });
  const firstMessage = new Promise((resolve) => { firstMessageResolve = resolve; });
  const providers = ["openai", "kimi"].map((id) => ({
    ...fakeProvider(id, id === "openai" ? "Gen" : "Kimi"),
    async generate() {
      started.add(id);
      if (started.size === 2) allStartedResolve();
      return new Promise((resolve) => releases.set(id, resolve));
    },
  }));
  const run = runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("你们都看看")],
    autoRelay: false,
    onEvent: (event) => { if (event.type === "message") firstMessageResolve(event.message); },
  });
  await allStarted;
  assert.deepEqual(started, new Set(["openai", "kimi"]));
  releases.get("kimi")("Kimi 先想好了");
  assert.equal((await firstMessage).providerId, "kimi");
  releases.get("openai")("Gen 随后回答");
  await run;
});

test("ambient AI replies are linked to the latest message from another AI", async () => {
  const messages = [];
  let genCalls = 0;
  let kimiCalls = 0;
  let kimiAmbientPrompt = "";
  const providers = [
    {
      ...fakeProvider("openai", "Gen"),
      async generate({ prompt }) {
        genCalls += 1;
        return genCalls === 1 ? "Gen 的首轮消息" : "[[SKIP_REPLY]]";
      },
    },
    {
      ...fakeProvider("kimi", "Kimi"),
      async generate({ prompt }) {
        kimiCalls += 1;
        if (kimiCalls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return "Kimi 稍后完成的首轮消息";
        }
        kimiAmbientPrompt = prompt;
        return "我来接 Gen 的话。";
      },
    },
  ];
  await runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("你们聊聊")],
    onEvent: (event) => { if (event.type === "message") messages.push(event.message); },
  });
  const genFirst = messages.find((message) => message.providerId === "openai");
  const kimiReply = messages.at(-1);
  assert.match(kimiAmbientPrompt, /会显示为回复 Gen/u);
  assert.equal(kimiReply.providerId, "kimi");
  assert.equal(kimiReply.triggeredBy, "Gen");
  assert.equal(kimiReply.replyToId, genFirst.id);
});

test("a member can explicitly skip a group turn without posting the control token", async () => {
  const events = [];
  const result = await runGroupChat({
    providers: [fakeProvider("kimi", "Kimi", "[[SKIP_REPLY]]")],
    participantIds: ["kimi"],
    history: [userMessage("随口说一句")],
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.attemptedMessages, 1);
  assert.equal(result.completedMessages, 0);
  assert.equal(events.some((event) => event.type === "message"), false);
  assert.equal(events.some((event) => event.type === "speaker_skip"), true);
});

test("an identical reply to the same quoted message is posted only once", async () => {
  const messages = [];
  const skipped = [];
  let kimiCalls = 0;
  let genCalls = 0;
  const providers = [
    {
      ...fakeProvider("kimi", "Kimi"),
      async generate() {
        kimiCalls += 1;
        return "[[QUOTE:u1]]\n……关了也好。";
      },
    },
    {
      ...fakeProvider("openai", "Gen"),
      async generate() {
        genCalls += 1;
        return genCalls === 1 ? "我先说一句。" : "[[SKIP_REPLY]]";
      },
    },
  ];
  await runGroupChat({
    providers,
    participantIds: ["kimi", "openai"],
    history: [userMessage("把思考关了")],
    onEvent: (event) => {
      if (event.type === "message") messages.push(event.message);
      if (event.type === "speaker_skip") skipped.push(event);
    },
  });
  assert.equal(kimiCalls, 2);
  assert.equal(messages.filter((message) => message.providerId === "kimi").length, 1);
  assert.equal(skipped.some((event) => event.provider.id === "kimi" && event.reason === "duplicate"), true);
});

test("Kimi cannot repeat identical content for a different reply target in one chain", async () => {
  const messages = [];
  const skipped = [];
  let kimiCalls = 0;
  let genCalls = 0;
  const providers = [
    {
      ...fakeProvider("kimi", "Kimi"),
      async generate() {
        kimiCalls += 1;
        return "……只告诉 Shin。今天说好了不碰服务器。";
      },
    },
    {
      ...fakeProvider("openai", "Gen"),
      async generate() {
        genCalls += 1;
        return genCalls === 1 ? "我补一句。" : "[[SKIP_REPLY]]";
      },
    },
  ];
  await runGroupChat({
    providers,
    participantIds: ["kimi", "openai"],
    history: [userMessage("好好上班")],
    onEvent: (event) => {
      if (event.type === "message") messages.push(event.message);
      if (event.type === "speaker_skip") skipped.push(event);
    },
  });
  assert.equal(kimiCalls, 2);
  assert.equal(messages.filter((message) => message.providerId === "kimi").length, 1);
  assert.equal(skipped.some((event) => event.provider.id === "kimi" && event.reason === "duplicate"), true);
});

test("Kimi deduplication still works after the bounded transcript trims old history", async () => {
  const messages = [];
  let kimiCalls = 0;
  let genCalls = 0;
  const history = Array.from({ length: 59 }, (_, index) => ({
    id: `old-${index}`,
    role: index % 2 ? "assistant" : "user",
    providerId: index % 2 ? "glm" : "",
    author: index % 2 ? "Shin" : "Okra",
    content: `old message ${index}`,
    createdAt: "2026-07-20T00:00:00.000Z",
  }));
  history.push({ ...userMessage("新消息"), id: "latest-user" });
  await runGroupChat({
    providers: [
      { ...fakeProvider("kimi", "Kimi"), async generate() { kimiCalls += 1; return "完全相同的回复"; } },
      { ...fakeProvider("openai", "Gen"), async generate() { genCalls += 1; return genCalls === 1 ? "我接一句" : "[[SKIP_REPLY]]"; } },
    ],
    participantIds: ["kimi", "openai"],
    history,
    onEvent: (event) => { if (event.type === "message") messages.push(event.message); },
  });
  assert.equal(kimiCalls, 2);
  assert.equal(messages.filter((message) => message.providerId === "kimi").length, 1);
});

test("shared Kimi dedupe registry blocks identical replies from overlapping chat runs", async () => {
  const registry = createGroupDedupeRegistry();
  const messages = [];
  const provider = fakeProvider("kimi", "Kimi", "并行轮次里面出现了一段完全相同而且足够长的回复");
  const run = (id) => runGroupChat({
    providers: [provider],
    participantIds: ["kimi"],
    history: [{ ...userMessage(`message ${id}`), id }],
    dedupeRegistry: registry,
    autoRelay: false,
    onEvent: (event) => { if (event.type === "message") messages.push(event.message); },
  });
  await Promise.all([run("u-overlap-1"), run("u-overlap-2")]);
  assert.equal(messages.length, 1);
});

test("a skipped call does not consume the visible group-message budget", async () => {
  let kimiCalls = 0;
  const result = await runGroupChat({
    providers: [
      fakeProvider("openai", "Gen", "请接一下。@Kimi"),
      {
        ...fakeProvider("kimi", "Kimi"),
        async generate() {
          kimiCalls += 1;
          return kimiCalls === 1 ? "[[SKIP_REPLY]]" : "这次我接到了。";
        },
      },
    ],
    participantIds: ["openai", "kimi"],
    history: [userMessage("开始")],
    maxMessages: 2,
  });
  assert.equal(result.attemptedMessages, 3);
  assert.equal(result.completedMessages, 2);
});

test("a normal group message invites all selected AI members", async () => {
  const messages = [];
  const providers = [fakeProvider("openai", "GPT"), fakeProvider("kimi", "Kimi")];
  await runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("大家聊聊这个方案")],
    autoRelay: false,
    onEvent: (event) => { if (event.type === "message") messages.push(event.message); },
  });
  assert.deepEqual(messages.map((message) => message.providerId), ["openai", "kimi"]);
  assert.equal(messages.every((message) => message.triggeredBy === "Okra"), true);
});

test("an AI can @ another AI and hand off the conversation", async () => {
  const messages = [];
  const providers = [
    {
      ...fakeProvider("openai", "GPT"),
      async generate({ prompt }) {
        return prompt.includes("首轮并发发言已经结束") ? "[[SKIP_REPLY]]" : "我先给一个观点。@Kimi 你怎么看？";
      },
    },
    {
      ...fakeProvider("kimi", "Kimi"),
      async generate({ prompt }) {
        return prompt.includes("GPT 刚刚在群里 @了你") ? "我补充另一种看法。" : "[[SKIP_REPLY]]";
      },
    },
  ];
  await runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("@GPT 先说说")],
    onEvent: (event) => { if (event.type === "message") messages.push(event.message); },
  });
  assert.deepEqual(messages.map((message) => message.providerId), ["openai", "kimi"]);
  assert.equal(messages[1].triggeredBy, "GPT");
  assert.equal(messages[1].replyToId, messages[0].id);
});

test("an explicit second-round @ reply is not starved by an ambient reaction call", async () => {
  const messages = [];
  let genCalls = 0;
  let kimiCalls = 0;
  const providers = [
    {
      ...fakeProvider("openai", "Gen"),
      async generate() {
        genCalls += 1;
        return genCalls === 1 ? "我先问。@Kimi 你怎么看？" : "收到你的回答，我接上了。";
      },
    },
    {
      ...fakeProvider("kimi", "Kimi"),
      async generate({ prompt }) {
        kimiCalls += 1;
        return prompt.includes("Gen 刚刚在群里 @了你") ? "我的回答在这里。@Gen" : "我也在听。";
      },
    },
  ];
  await runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("开始吧")],
    onEvent: (event) => { if (event.type === "message") messages.push(event.message); },
  });
  assert.ok(genCalls >= 2);
  assert.ok(kimiCalls >= 2);
  assert.equal(messages.some((message) => message.providerId === "openai" && message.triggeredBy === "Kimi"), true);
});

test("members can react after the initial concurrent round without being @ mentioned", async () => {
  const messages = [];
  let genCalls = 0;
  let kimiCalls = 0;
  const providers = [
    {
      ...fakeProvider("openai", "Gen"),
      async generate({ prompt }) {
        genCalls += 1;
        if (prompt.includes("首轮并发发言已经结束")) {
          assert.match(prompt, /Kimi：Kimi 的首轮观点/u);
          return "我接一下 Kimi 刚才的观点。";
        }
        return "Gen 的首轮观点";
      },
    },
    {
      ...fakeProvider("kimi", "Kimi"),
      async generate({ prompt }) {
        kimiCalls += 1;
        return prompt.includes("首轮并发发言已经结束") ? "[[SKIP_REPLY]]" : "Kimi 的首轮观点";
      },
    },
  ];
  await runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("你们聊聊")],
    onEvent: (event) => { if (event.type === "message") messages.push(event.message); },
  });
  assert.equal(genCalls, 2);
  assert.equal(kimiCalls, 3);
  assert.deepEqual(messages.map((message) => message.content), [
    "Gen 的首轮观点",
    "Kimi 的首轮观点",
    "我接一下 Kimi 刚才的观点。",
  ]);
  assert.equal(messages.at(-1).triggeredBy, "Kimi");
});

test("Gen is asked for at most one unmentioned ambient follow-up", async () => {
  let genCalls = 0;
  let kimiCalls = 0;
  const result = await runGroupChat({
    providers: [
      {
        ...fakeProvider("codex-cli", "Gen"),
        async generate() { genCalls += 1; return `Gen ${genCalls}`; },
      },
      {
        ...fakeProvider("kimi", "Kimi"),
        async generate() { kimiCalls += 1; return `Kimi ${kimiCalls}`; },
      },
    ],
    participantIds: ["codex-cli", "kimi"],
    history: [userMessage("你们聊聊")],
  });
  assert.equal(genCalls, 1 + MAX_AMBIENT_GEN_REPLIES);
  assert.equal(kimiCalls, 3);
  assert.equal(result.ambientTurnsByProvider["codex-cli"], MAX_AMBIENT_GEN_REPLIES);
});

test("repeated AI-to-AI mentions can continue until the total visible-message limit", async () => {
  let gptCalls = 0;
  let kimiCalls = 0;
  const providers = [
    fakeProvider("openai", "GPT", () => `@Kimi 接一下 ${++gptCalls}`),
    fakeProvider("kimi", "Kimi", () => `@GPT 再补充 ${++kimiCalls}`),
  ];
  const result = await runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("@GPT 开始")],
    maxMessages: 999,
  });
  assert.equal(result.completedMessages, MAX_REPLIES_PER_MEMBER * 2);
  assert.equal(result.reason, "safety_limit");
  assert.equal(result.maxMessages, MAX_REPLIES_PER_MEMBER * 2);
  assert.deepEqual(result.turnsByProvider, {
    openai: MAX_REPLIES_PER_MEMBER,
    kimi: MAX_REPLIES_PER_MEMBER,
  });
});

test("every selected group member can still participate in five directly addressed rounds", async () => {
  let genCalls = 0;
  let kimiCalls = 0;
  let shinCalls = 0;
  const providers = [
    fakeProvider("openai", "Gen", () => `@Kimi @Shin 继续 ${++genCalls}`),
    fakeProvider("kimi", "Kimi", () => `@Gen @Shin 继续 ${++kimiCalls}`),
    fakeProvider("glm", "Shin", () => `@Gen @Kimi 继续 ${++shinCalls}`),
  ];
  const result = await runGroupChat({
    providers,
    participantIds: ["openai", "kimi", "glm"],
    history: [userMessage("继续聊")],
  });
  assert.equal(result.completedMessages, MAX_REPLIES_PER_MEMBER * 3);
  assert.equal(result.maxMessages, MAX_REPLIES_PER_MEMBER * 3);
  assert.deepEqual(result.turnsByProvider, {
    openai: MAX_REPLIES_PER_MEMBER,
    kimi: MAX_REPLIES_PER_MEMBER,
    glm: MAX_REPLIES_PER_MEMBER,
  });
});

test("the hard chain budget stops a still-pending handoff", async () => {
  const providers = [
    fakeProvider("openai", "GPT", "@Kimi 接一下"),
    fakeProvider("kimi", "Kimi", "@GPT 接一下"),
  ];
  const result = await runGroupChat({
    providers,
    participantIds: ["openai", "kimi"],
    history: [userMessage("@GPT 开始")],
    maxMessages: 2,
  });
  assert.equal(result.completedMessages, 2);
  assert.equal(result.reason, "safety_limit");
});

test("stop aborts before another group member speaks", async () => {
  const controller = new AbortController();
  let calls = 0;
  const provider = fakeProvider("openai", "GPT");
  provider.generate = async () => {
    calls += 1;
    controller.abort("test");
    return "@GPT";
  };
  const result = await runGroupChat({
    providers: [provider],
    participantIds: ["openai"],
    history: [userMessage("你好")],
    signal: controller.signal,
  });
  assert.equal(calls, 1);
  assert.equal(result.reason, "stopped");
});

test("long-term memories are injected into an AI group member prompt", async () => {
  let systemPrompt = "";
  const provider = fakeProvider("openai", "GPT");
  provider.generate = async ({ system }) => { systemPrompt = system; return "记住了"; };
  await runGroupChat({
    providers: [provider],
    participantIds: ["openai"],
    history: [userMessage("给我建议")],
    memories: [{ id: "m1", text: "用户喜欢先看结论" }],
  });
  assert.match(systemPrompt, /用户喜欢先看结论/);
  assert.match(systemPrompt, /微信群或 Telegram 群/);
});

test("mention parsing supports labels, aliases and everyone", () => {
  const providers = [fakeProvider("openai", "GPT"), fakeProvider("claude-code", "Claude Code")];
  assert.deepEqual(extractMentions("@ChatGPT 请和 @Claude Code 讨论", providers).ids, ["openai", "claude-code"]);
  assert.equal(extractMentions("@所有人 来聊聊", providers).hasEveryone, true);
});
