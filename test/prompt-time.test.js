import test from "node:test";
import assert from "node:assert/strict";
import { formatPromptTime, timestampedText } from "../src/prompt-time.js";
import { buildGenPrompt } from "../src/gen-private.js";

test("prompt timestamps are rendered in Asia/Shanghai with an explicit offset", () => {
  const value = "2026-07-19T18:12:27.000Z";
  assert.equal(formatPromptTime(value), "2026-07-20 02:12:27（Asia/Shanghai，UTC+08:00）");
  assert.equal(timestampedText("你好", value), "[发送时间：2026-07-20 02:12:27（Asia/Shanghai，UTC+08:00）]\n你好");
});

test("Gen receives timestamps for current and recent private messages", () => {
  const value = "2026-07-19T18:12:27.000Z";
  const prompt = buildGenPrompt({
    sentAt: value,
    prompt: "刚才说到哪了？",
    history: [{ role: "assistant", content: "说到电影。", createdAt: "2026-07-19T18:10:00.000Z" }],
  });
  assert.match(prompt, /当前时间：2026-07-20 02:12:27/u);
  assert.match(prompt, /\[2026-07-20 02:10:00（Asia\/Shanghai，UTC\+08:00）\] Gen：说到电影/u);
  assert.match(prompt, /\[发送时间：2026-07-20 02:12:27（Asia\/Shanghai，UTC\+08:00）\] 小O刚刚说：刚才说到哪了/u);
});
