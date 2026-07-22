import test from "node:test";
import assert from "node:assert/strict";
import { normalizeQuote, quotePromptLine } from "../src/quote-context.js";
import { buildKimiPrivateSystem } from "../src/kimi-private.js";
import { buildGlmPrivateSystem } from "../src/glm-private.js";
import { buildGenPrompt } from "../src/gen-private.js";
import { runGroupChat } from "../src/groupchat.js";
import { RoundtableStore } from "../src/store.js";

const longQuote = "一二三四五六七八九十甲乙丙丁戊己";
const quote = { messageId: "message-123", author: "Gen", text: longQuote };

test("quoted text keeps the complete message within a generous safety limit", () => {
  assert.deepEqual(normalizeQuote(quote), { messageId: "message-123", author: "Gen", text: quote.text.replace(/\s+/gu, " ").trim() });
  assert.equal(quotePromptLine(quote, "Okra"), `Okra引用了Gen的一句话“${longQuote}”`);
});

test("private and group prompts receive explicit quote context", async () => {
  const expected = `Okra引用了Gen的一句话“${longQuote}”`;
  assert.match(buildKimiPrivateSystem([], "2026-07-21T00:00:00.000Z", quote), new RegExp(expected));
  assert.match(buildGlmPrivateSystem([], "2026-07-21T00:00:00.000Z", quote), new RegExp(expected));
  assert.match(buildGenPrompt({ prompt: "继续说", quote }), new RegExp(expected));

  let request;
  const provider = {
    id: "kimi", label: "Kimi", kind: "test", model: "test", available: true,
    async generate(input) { request = input; return "收到"; },
  };
  await runGroupChat({
    providers: [provider],
    participantIds: ["kimi"],
    history: [{ id: "user-quote", role: "user", author: "Okra", channel: "group", content: "继续说", quote }],
  });
  assert.match(request.system, new RegExp(expected));
  assert.match(request.prompt, new RegExp(expected));
});

test("the message store preserves normalized quote metadata", async () => {
  const store = new RoundtableStore({ filePath: "", archiveFilePath: ":memory:" });
  try {
    await store.addMessage({ id: "quoted-user", role: "user", channel: "group", content: "继续", quote });
    const [message] = (await store.getSnapshot()).messages;
    assert.deepEqual(message.quote, { messageId: "message-123", author: "Gen", text: longQuote });
  } finally {
    store.close();
  }
});
