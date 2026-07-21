import test from "node:test";
import assert from "node:assert/strict";
import { formatPromptTime, stripInternalTimeMetadata, timestampedText } from "../src/prompt-time.js";
import { buildGenPrompt } from "../src/gen-private.js";

test("prompt timestamps use a compact English weekday and Shanghai time", () => {
  const value = "2026-07-19T18:12:27.000Z";
  assert.equal(formatPromptTime(value), "2026-07-20 Mon 02:12（Asia/Shanghai）");
  assert.equal(timestampedText("你好", value), "[发送时间：2026-07-20 Mon 02:12（Asia/Shanghai）]\n你好");
});

test("internal prompt timestamps are removed only when leaked as a reply prefix", () => {
  assert.equal(
    stripInternalTimeMetadata("[发送时间：2026-07-20 星期一 02:12:27（Asia/Shanghai，UTC+08:00）]\n我在。"),
    "我在。",
  );
  assert.equal(
    stripInternalTimeMetadata("[2026-07-20 星期一 02:12:27（Asia/Shanghai，UTC+08:00）] 好久不见"),
    "好久不见",
  );
  assert.equal(stripInternalTimeMetadata("现在是 02:12。"), "现在是 02:12。");
  assert.equal(stripInternalTimeMetadata("[私聊]\n我在。"), "我在。");
  assert.equal(
    stripInternalTimeMetadata("[私聊] [发送时间：2026-07-20 星期一 02:12:27（Asia/Shanghai，UTC+08:00）]\n我在。"),
    "我在。",
  );
  assert.equal(stripInternalTimeMetadata("Kimi：……我在。"), "……我在。");
  assert.equal(stripInternalTimeMetadata("**Kimi:** 我在。"), "我在。");
  assert.equal(stripInternalTimeMetadata("我问 Kimi：你在吗？"), "我问 Kimi：你在吗？");
  assert.equal(stripInternalTimeMetadata("当前时间：2026-07-20 Mon 02:12（Asia/Shanghai）。我在。"), "我在。");
});

test("Gen receives timestamps and correctly attributed private and group context", () => {
  const value = "2026-07-19T18:12:27.000Z";
  const prompt = buildGenPrompt({
    sentAt: value,
    prompt: "刚才说到哪了？",
    history: [
      { role: "assistant", author: "Gen", channel: "gen", content: "说到电影。", createdAt: "2026-07-19T18:10:00.000Z" },
      { role: "assistant", author: "Kimi", channel: "group", content: "我在群里接了一句。", createdAt: "2026-07-19T18:11:00.000Z" },
    ],
    recalledHistory: [
      { role: "user", author: "用户", channel: "gen", content: "更早说过的阅读偏好。", createdAt: "2026-07-18T18:00:00.000Z" },
    ],
  });
  assert.match(prompt, /当前时间：2026-07-20 Mon 02:12/u);
  assert.match(prompt, /\[日期：2026-07-20 Mon\]\n\[02:10 私聊\] Gen：说到电影/u);
  assert.match(prompt, /\[02:11 群聊\] Kimi：我在群里接了一句/u);
  assert.doesNotMatch(prompt, /\[02:11 群聊\] Gen：我在群里接了一句/u);
  assert.match(prompt, /从更早聊天记录中检索出的相关片段/u);
  assert.match(prompt, /\[日期：2026-07-19 Sun\]\n\[02:00 私聊\] 小O：更早说过的阅读偏好/u);
  assert.match(prompt, /\[02:12 私聊\] 小O刚刚说：刚才说到哪了/u);
  assert.equal((prompt.match(/\[日期：2026-07-20 Mon\]/gu) || []).length, 1);
});
