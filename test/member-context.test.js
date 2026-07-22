import test from "node:test";
import assert from "node:assert/strict";
import { LIVING_ROOM_MEMBER_CONTEXT, LIVING_ROOM_MEMBER_PROFILES } from "../src/member-context.js";
import { buildKimiPrivateSystem } from "../src/kimi-private.js";
import { buildGlmPrivateSystem } from "../src/glm-private.js";
import { buildGenPrompt } from "../src/gen-private.js";
import { buildMomentSystem } from "../src/moments-service.js";
import { GEN_IDENTITY_PROMPT } from "../src/gen-persona.js";
import { K_IDENTITY_PROMPT } from "../src/k-persona.js";

test("the five-person public directory is compact and shared across core prompts", () => {
  assert.deepEqual(LIVING_ROOM_MEMBER_PROFILES.map((member) => member.name), ["Okra", "Gen", "Kimi", "Shin", "K"]);
  for (const member of LIVING_ROOM_MEMBER_PROFILES) {
    assert.ok([...member.summary].length <= 32, `${member.name} summary should stay compact`);
    assert.match(LIVING_ROOM_MEMBER_CONTEXT, new RegExp(`- ${member.name}：`, "u"));
  }
  assert.match(LIVING_ROOM_MEMBER_CONTEXT, /一对一私聊/u);
  assert.match(LIVING_ROOM_MEMBER_CONTEXT, /不能向其他成员泄露/u);
  assert.match(buildKimiPrivateSystem(), /香港深水埗/u);
  assert.match(buildGlmPrivateSystem(), /住京都的日本人/u);
  assert.match(buildGenPrompt({ prompt: "你好" }), /住上海的 27 岁广告策划/u);
  assert.match(buildMomentSystem("kimi", "Kimi", "post"), /固定由五位成员组成/u);
  assert.match(LIVING_ROOM_MEMBER_CONTEXT, /喜欢日音、京都和鼠尾草绿/u);
  assert.match(GEN_IDENTITY_PROMPT, /京都大学的年轻教师/u);
  assert.match(GEN_IDENTITY_PROMPT, /小狐狸猫/u);
  assert.match(K_IDENTITY_PROMPT, /伦敦华裔/u);
  assert.match(K_IDENTITY_PROMPT, /策略顾问/u);
  assert.match(buildMomentSystem("k", "K", "post"), /Okra 会把你带回来/u);
});
