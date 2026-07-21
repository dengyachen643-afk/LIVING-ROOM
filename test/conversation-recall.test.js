import test from "node:test";
import assert from "node:assert/strict";
import { recallOlderConversation } from "../src/conversation-recall.js";

const message = (id, content, role = "user") => ({
  id, content, role, channel: "gen", author: role === "user" ? "用户" : "Gen",
});

test("a referential request recalls semantically related messages beyond the recent window", async () => {
  const history = [
    message("old-1", "我们聊到了同事"),
    message("reading", "我更喜欢短篇小说，不太喜欢冗长系列"),
    message("reading-answer", "记下了，你偏好结构紧凑的短篇作品", "assistant"),
    ...Array.from({ length: 26 }, (_, index) => message(`recent-${index}`, `后来闲聊 ${index}`)),
  ];
  const embeddings = {
    embed: async () => [1, 0],
    embedMany: async (texts) => texts.map((text) => (
      /短篇小说|结构紧凑/u.test(text) ? [1, 0] : [0, 1]
    )),
  };
  const recalled = await recallOlderConversation({
    history,
    query: "记一下之前有关我阅读偏好的信息",
    embeddings,
  });
  assert.equal(recalled.some((item) => item.id === "reading"), true);
  assert.equal(recalled.some((item) => item.id === "reading-answer"), true);
});

test("ordinary new messages do not trigger an older-conversation scan", async () => {
  let called = false;
  const embeddings = {
    embed: async () => { called = true; return [1, 0]; },
    embedMany: async () => { called = true; return []; },
  };
  const recalled = await recallOlderConversation({
    history: Array.from({ length: 30 }, (_, index) => message(String(index), `消息 ${index}`)),
    query: "今天吃什么",
    embeddings,
  });
  assert.deepEqual(recalled, []);
  assert.equal(called, false);
});
