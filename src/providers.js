import { spawn } from "node:child_process";

const DEFAULT_MAX_OUTPUT_TOKENS = 1600;
const MAX_CAPTURE_CHARS = 1_000_000;

export function createProviders(env = process.env, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const spawnImpl = dependencies.spawnImpl || spawn;
  const maxOutputTokens = positiveInt(env.MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, 200, 8000);

  const genApi = createOpenAIProvider(env, fetchImpl, maxOutputTokens);
  const genLocal = createCodexCliProvider(env, spawnImpl);
  const kApi = createAnthropicProvider(env, fetchImpl, maxOutputTokens);
  const kLocal = createClaudeCodeProvider(env, spawnImpl);
  return [
    genLocal.available ? genLocal : genApi,
    createKimiProvider(env, fetchImpl, maxOutputTokens),
    kLocal.available ? kLocal : kApi,
  ];
}

function createOpenAIProvider(env, fetchImpl, maxOutputTokens) {
  const apiKey = clean(env.OPENAI_API_KEY);
  const model = clean(env.OPENAI_MODEL) || "gpt-5.6-terra";
  const baseUrl = stripSlash(clean(env.OPENAI_BASE_URL) || "https://api.openai.com/v1");
  return {
    id: "openai",
    label: "Gen",
    kind: "API",
    model,
    available: Boolean(apiKey),
    unavailableReason: apiKey ? "" : "缺少 OPENAI_API_KEY",
    async generate({ system, prompt, signal, images = [] }) {
      const body = {
        model,
        instructions: system,
        input: prompt,
        max_output_tokens: maxOutputTokens,
      };
      const effort = clean(env.OPENAI_REASONING_EFFORT);
      if (effort) body.reasoning = { effort };
      const payload = await postJson(fetchImpl, `${baseUrl}/responses`, {
        Authorization: `Bearer ${apiKey}`,
      }, body, signal, "OpenAI");
      return extractOpenAIText(payload);
    },
  };
}

function createKimiProvider(env, fetchImpl, maxOutputTokens) {
  const apiKey = clean(env.MOONSHOT_API_KEY);
  const model = clean(env.KIMI_MODEL) || "kimi-k3";
  const baseUrl = stripSlash(clean(env.KIMI_BASE_URL) || "https://api.moonshot.cn/v1");
  return {
    id: "kimi",
    label: "Kimi",
    kind: "API",
    model,
    available: Boolean(apiKey),
    unavailableReason: apiKey ? "" : "缺少 MOONSHOT_API_KEY",
    async generate({ system, prompt, signal, images = [] }) {
      const userContent = images.length ? [
        ...images.slice(0, 4).map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
        { type: "text", text: prompt || "请看这张图片。" },
      ] : prompt;
      const payload = await postJson(fetchImpl, `${baseUrl}/chat/completions`, {
        Authorization: `Bearer ${apiKey}`,
      }, {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        max_completion_tokens: maxOutputTokens,
      }, signal, "Kimi");
      const text = payload?.choices?.[0]?.message?.content;
      if (!clean(text)) throw new Error("Kimi 返回了空消息");
      return clean(text);
    },
  };
}

function createAnthropicProvider(env, fetchImpl, maxOutputTokens) {
  const apiKey = clean(env.ANTHROPIC_API_KEY);
  const model = clean(env.ANTHROPIC_MODEL) || "claude-opus-4-8";
  const baseUrl = stripSlash(clean(env.ANTHROPIC_BASE_URL) || "https://api.anthropic.com");
  return {
    id: "anthropic",
    label: "K",
    kind: "API",
    model,
    available: Boolean(apiKey),
    unavailableReason: apiKey ? "" : "缺少 ANTHROPIC_API_KEY",
    async generate({ system, prompt, signal, images = [] }) {
      const payload = await postJson(fetchImpl, `${baseUrl}/v1/messages`, {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      }, {
        model,
        max_tokens: maxOutputTokens,
        system,
        messages: [{ role: "user", content: prompt }],
      }, signal, "Claude");
      const text = (payload?.content || [])
        .filter((block) => block?.type === "text")
        .map((block) => block.text || "")
        .join("\n")
        .trim();
      if (!text) throw new Error("Claude 返回了空消息");
      return text;
    },
  };
}

function createClaudeCodeProvider(env, spawnImpl) {
  const enabled = truthy(env.CLAUDE_CODE_ENABLED);
  const command = clean(env.CLAUDE_CODE_COMMAND) || "claude";
  const model = clean(env.CLAUDE_CODE_MODEL) || "opus";
  return {
    id: "claude-code",
    label: "K",
    kind: "CLI",
    model,
    available: enabled,
    unavailableReason: enabled ? "" : "在 .env 中设置 CLAUDE_CODE_ENABLED=true",
    async generate({ system, prompt, signal, images = [] }) {
      const args = [
        "-p",
        "--output-format", "json",
        "--input-format", "text",
        "--permission-mode", "plan",
        "--max-turns", "1",
        "--tools", "",
        "--disallowedTools", "mcp__*",
        "--no-session-persistence",
        "--system-prompt", system,
      ];
      if (model) args.push("--model", model);
      const output = await runCommand(spawnImpl, command, args, prompt, signal);
      let payload;
      try {
        payload = JSON.parse(output.stdout);
      } catch {
        throw new Error(`Claude Code 输出不是有效 JSON：${tail(output.stderr || output.stdout, 300)}`);
      }
      if (payload?.is_error) throw new Error(clean(payload.result) || "Claude Code 执行失败");
      const text = clean(payload?.result);
      if (!text) throw new Error("Claude Code 返回了空消息");
      return text;
    },
  };
}

function createCodexCliProvider(env, spawnImpl) {
  const enabled = truthy(env.CODEX_CLI_ENABLED);
  const command = clean(env.CODEX_CLI_COMMAND) || "codex";
  const model = clean(env.CODEX_CLI_MODEL);
  const runtimeDir = clean(env.GEN_RUNTIME_DIR) || process.cwd();
  return {
    id: "codex-cli",
    label: "Gen",
    kind: "CLI · 实验",
    model: model || "登录默认模型",
    available: enabled,
    unavailableReason: enabled ? "" : "在 .env 中设置 CODEX_CLI_ENABLED=true",
    async generate({ system, prompt, signal, images = [] }) {
      const fullPrompt = `${system}\n\n${prompt}`;
      const args = [
        "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules",
        "--sandbox", "read-only", "--skip-git-repo-check", "--color", "never", "--json",
        "-c", `model_reasoning_effort=\"${clean(env.GEN_REASONING_EFFORT) || "medium"}\"`,
        "-c", "service_tier=\"priority\"",
        "-c", "web_search=\"live\"",
        "-C", runtimeDir,
      ];
      for (const image of images.slice(0, 4)) {
        if (clean(image?.filePath)) args.push("--image", image.filePath);
      }
      if (model) args.push("--model", model);
      args.push("-");
      const output = await runCommand(spawnImpl, command, args, fullPrompt, signal);
      const text = extractCodexJsonl(output.stdout);
      if (!text) throw new Error(`Codex 没有返回可读消息：${tail(output.stderr || output.stdout, 300)}`);
      return text;
    },
  };
}

async function postJson(fetchImpl, url, headers, body, signal, label) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw new Error(`${label} 网络请求失败：${error?.message || error}`);
  }
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { /* handled below */ }
  if (!response.ok) {
    const detail = clean(payload?.error?.message || payload?.message || raw);
    throw new Error(`${label} API ${response.status}：${tail(detail, 500) || "请求失败"}`);
  }
  return payload;
}

function extractOpenAIText(payload) {
  if (clean(payload?.output_text)) return clean(payload.output_text);
  const parts = [];
  for (const item of payload?.output || []) {
    for (const block of item?.content || []) {
      if (block?.type === "output_text" && block.text) parts.push(block.text);
    }
  }
  const text = parts.join("\n").trim();
  if (!text) throw new Error("OpenAI 返回了空消息");
  return text;
}

function extractCodexJsonl(stdout) {
  const messages = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const item = event?.item || event?.payload?.item;
      if ((event?.type === "item.completed" || event?.type === "item_completed")
        && (item?.type === "agent_message" || item?.type === "assistant_message")) {
        const value = clean(item?.text || item?.content);
        if (value) messages.push(value);
      }
      if (event?.type === "message" && event?.role === "assistant" && event?.content) {
        messages.push(clean(event.content));
      }
    } catch { /* ignore non-JSON diagnostics */ }
  }
  return messages.filter(Boolean).at(-1) || "";
}

function runCommand(spawnImpl, command, args, input, signal) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child;
    try {
      child = spawnImpl(command, args, {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new Error(`无法启动 ${command}：${error.message}`));
      return;
    }
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const onAbort = () => {
      try { child.kill(); } catch { /* best effort */ }
      finish(reject, abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    child.on("error", (error) => finish(reject, new Error(`无法启动 ${command}：${error.message}`)));
    child.stdout?.on("data", (chunk) => { stdout = cap(`${stdout}${chunk}`); });
    child.stderr?.on("data", (chunk) => { stderr = cap(`${stderr}${chunk}`); });
    child.on("close", (code) => {
      if (code === 0) finish(resolve, { stdout: stdout.trim(), stderr: stderr.trim() });
      else finish(reject, new Error(`${command} 退出码 ${code}：${tail(stderr || stdout, 500)}`));
    });
    child.stdin?.end(input, "utf8");
  });
}

function abortError() {
  const error = new Error("已停止");
  error.name = "AbortError";
  return error;
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(clean(value).toLowerCase());
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stripSlash(value) {
  return value.replace(/\/+$/, "");
}

function tail(value, length) {
  const text = String(value || "");
  return text.length > length ? text.slice(-length) : text;
}

function cap(value) {
  return value.length > MAX_CAPTURE_CHARS ? value.slice(-MAX_CAPTURE_CHARS) : value;
}

function positiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export const providerInternals = { extractOpenAIText, extractCodexJsonl };
