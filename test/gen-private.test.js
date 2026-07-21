import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { buildGenPrompt, generateGenPrivate } from "../src/gen-private.js";

test("Gen can occasionally mix natural Japanese into conversation", () => {
  const prompt = buildGenPrompt({ prompt: "今天怎么样" });
  assert.match(prompt, /偶尔夹杂简短、自然的日语/u);
  assert.match(prompt, /不要为了证明身份而每条都夹日语/u);
});

test("Gen work mode uses workspace-write in the selected root and streams safe activity summaries", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gen-workspace-"));
  let invocation;
  const streamed = [];
  const events = [
    { type: "item.started", item: { id: "cmd-1", type: "command_execution", command: "npm test", status: "in_progress" } },
    { type: "item.completed", item: { id: "cmd-1", type: "command_execution", command: "npm test", status: "completed", exit_code: 0 } },
    { type: "item.completed", item: { id: "files-1", type: "file_change", status: "completed" } },
    { type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ reply: "任务完成。", memoryActions: [] }) } },
  ];
  const spawnImpl = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      for (const event of events) child.stdout.write(`${JSON.stringify(event)}\n`);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);
    });
    return child;
  };

  try {
    const result = await generateGenPrivate({
      spawnImpl,
      command: "codex-test",
      mode: "work",
      workspaceDir: directory,
      workspaceLabel: "测试工作区",
      prompt: "把测试跑通",
      onEvent: (event) => streamed.push(event),
    });
    assert.equal(invocation.command, "codex-test");
    assert.deepEqual(invocation.args.slice(invocation.args.indexOf("--sandbox"), invocation.args.indexOf("--sandbox") + 2), ["--sandbox", "workspace-write"]);
    assert.equal(invocation.args.includes("--ignore-rules"), false);
    assert.equal(invocation.args.includes('approval_policy="never"'), true);
    assert.equal(invocation.args.includes('model_reasoning_effort="medium"'), true);
    assert.equal(invocation.args.some((arg) => arg.startsWith("service_tier=")), false);
    assert.equal(invocation.args[invocation.args.indexOf("--model") + 1], "gpt-5.6-sol");
    if (process.platform === "win32") assert.equal(invocation.args.includes('windows.sandbox="unelevated"'), true);
    assert.equal(invocation.args[invocation.args.indexOf("-C") + 1], path.resolve(directory));
    assert.equal(streamed.some((event) => event.type === "tool_start" && event.label.includes("npm test")), true);
    assert.equal(streamed.some((event) => event.type === "tool_done" && event.label === "修改文件"), true);
    assert.equal(result.content, "任务完成。");
    assert.equal(result.toolCalls.some((item) => item.label === "修改文件"), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
