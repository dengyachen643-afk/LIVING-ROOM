import http from "node:http";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createProviders } from "./providers.js";
import { HARD_MAX_CHAIN_MESSAGES, HARD_MAX_PER_AGENT, HARD_MAX_RELAY_DEPTH, runGroupChat } from "./groupchat.js";
import { streamKimiPrivate } from "./kimi-private.js";
import { decideKimiMemoryActions } from "./kimi-memory.js";
import { KimiFormulaTools } from "./kimi-tools.js";
import { generateGenPrivate } from "./gen-private.js";
import { DEFAULT_EMBEDDING_MODEL, LocalEmbeddingService } from "./embeddings.js";
import { RoundtableStore } from "./store.js";
import { publicAttachments, saveIncomingImages } from "./uploads.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

export function createServer({
  env = process.env,
  providers,
  store = new RoundtableStore({ filePath: clean(env.ROUNDTABLE_STATE_FILE) || ".roundtable/state.json" }),
  fetchImpl = globalThis.fetch,
  embeddingService,
  genGenerate = generateGenPrivate,
  kimiToolRegistry,
} = {}) {
  const activeRuns = new Map();
  const accessToken = clean(env.ROUNDTABLE_ACCESS_TOKEN);
  const gptMemoryToken = clean(env.GPT_MEMORY_TOKEN);
  const publicAccess = parseBoolean(env.ROUNDTABLE_PUBLIC_ACCESS, false);
  const kimiKeyFile = clean(env.KIMI_KEY_FILE) ? path.resolve(clean(env.KIMI_KEY_FILE)) : "";
  const providerEnv = { ...env };
  if (!clean(providerEnv.MOONSHOT_API_KEY) && kimiKeyFile) {
    try { providerEnv.MOONSHOT_API_KEY = clean(readFileSync(kimiKeyFile, "utf8")); }
    catch { /* private setup can still configure it later */ }
  }
  const configuredProviders = providers || createProviders(providerEnv);
  const vectorEnabled = parseBoolean(env.MEMORY_VECTOR_ENABLED, false);
  const kimiAutoMemory = parseBoolean(env.KIMI_AUTO_MEMORY, false);
  const kimiToolsEnabled = parseBoolean(env.KIMI_TOOLS_ENABLED, false);
  const genPrivateEnabled = parseBoolean(env.GEN_PRIVATE_ENABLED, false);
  const uploadDir = path.resolve(clean(env.UPLOAD_DIR) || ".roundtable/uploads");
  const kimiTools = kimiToolRegistry || (kimiToolsEnabled ? new KimiFormulaTools({ fetchImpl }) : null);
  const embeddings = embeddingService || (vectorEnabled ? new LocalEmbeddingService({
    model: clean(env.MEMORY_EMBEDDING_MODEL) || DEFAULT_EMBEDDING_MODEL,
    cacheDir: clean(env.MEMORY_MODEL_CACHE) || ".roundtable/models",
    remoteHost: clean(env.HF_ENDPOINT),
  }) : null);

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://localhost");
      const isMemoryRoute = url.pathname === "/api/memories" || url.pathname.startsWith("/api/memories/");
      const memoryScope = isMemoryRoute ? getMemoryScope(request, accessToken, gptMemoryToken, publicAccess) : "";
      const acceptedTokens = isMemoryRoute
        ? [accessToken, gptMemoryToken].filter(Boolean)
        : [accessToken].filter(Boolean);
      if (!publicAccess && url.pathname.startsWith("/api/") && acceptedTokens.length
        && (isMemoryRoute ? !memoryScope : !isAuthorized(request, acceptedTokens))) {
        return sendJson(response, 401, { error: "需要群聊访问口令" });
      }
      if (request.method === "GET" && url.pathname === "/openapi.json") {
        return sendJson(response, 200, createMemoryOpenApi({ request, env }));
      }
      if (request.method === "GET" && url.pathname === "/api/config") {
        const storedKimiKey = await readStoredKimiKey(kimiKeyFile);
        return sendJson(response, 200, {
          providers: configuredProviders.map(({ id, label, kind, model, available, unavailableReason }) => ({
            id, label, kind, model, available, unavailableReason,
          })),
          limits: {
            maxChainMessages: HARD_MAX_CHAIN_MESSAGES,
            maxPerAgent: HARD_MAX_PER_AGENT,
            maxRelayDepth: HARD_MAX_RELAY_DEPTH,
          },
          memory: {
            storage: "server",
            longTerm: true,
            vectorEnabled: Boolean(embeddings),
            embeddingModel: embeddings?.model || "",
            kimiAutoMemory,
          },
          uploads: { enabled: true, maxImages: 4, maxImageBytes: 6_000_000 },
          tools: { kimi: Boolean(kimiTools), gen: true },
          publicAccess,
          kimiPrivate: {
            model: clean(env.KIMI_PRIVATE_MODEL) || clean(env.KIMI_MODEL) || "kimi-k3",
            envKeyAvailable: Boolean(clean(env.MOONSHOT_API_KEY) || storedKimiKey),
            acceptsSessionKey: true,
            persistsServerKey: Boolean(kimiKeyFile),
          },
          genPrivate: {
            enabled: genPrivateEnabled,
            model: clean(env.GEN_PRIVATE_MODEL) || "gpt-5.6-sol",
          },
        });
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        return sendJson(response, 200, publicSnapshot(await store.getSnapshot()));
      }
      if (request.method === "GET" && url.pathname === "/api/memories") {
        const query = url.searchParams.get("query");
        const namespace = url.searchParams.get("namespace");
        const limit = url.searchParams.get("limit");
        if (memoryScope === "g" && namespace && !["g", "gpt"].includes(namespace)) {
          return sendJson(response, 403, { error: "G老师编辑密钥只能访问 G老师记忆" });
        }
        const queryVector = await embedSafe(embeddings, query);
        const memories = memoryScope === "g" && !namespace
          ? await listGMemories(store, { query, limit, queryVector })
          : await store.listMemories({ query, namespace, limit, queryVector });
        return sendJson(response, 200, {
          memories: memories.map(publicMemory),
          count: memories.length,
          searchMode: query ? (queryVector.length ? "hybrid" : "keyword") : "recent",
          vectorReady: Boolean(queryVector.length),
        });
      }
      if (request.method === "POST" && url.pathname === "/api/memories") {
        const body = await readJsonBody(request);
        if (memoryScope === "g") {
          body.namespace = "g";
          body.source = clean(body.source) || "g-teacher";
        }
        const memory = await store.addMemory({ ...body, vectorStatus: embeddings ? "pending" : "not_indexed" });
        const indexed = await indexMemorySafe(store, embeddings, memory);
        return sendJson(response, 201, { memory: publicMemory(indexed || memory) });
      }
      if (request.method === "PATCH" && url.pathname.startsWith("/api/memories/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/memories/".length));
        if (memoryScope === "g" && !await isGMemory(store, id)) {
          return sendJson(response, 403, { error: "G老师编辑密钥不能修改其他记忆" });
        }
        const updates = await readJsonBody(request);
        if (memoryScope === "g") delete updates.namespace;
        const memory = await store.updateMemory(id, updates);
        if (!memory) return sendJson(response, 404, { error: "记忆不存在" });
        const indexed = updates.text === undefined ? memory : await indexMemorySafe(store, embeddings, memory);
        return sendJson(response, 200, { memory: publicMemory(indexed || memory) });
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/api/memories/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/memories/".length));
        if (memoryScope === "g" && !await isGMemory(store, id)) {
          return sendJson(response, 403, { error: "G老师编辑密钥不能删除其他记忆" });
        }
        return sendJson(response, 200, { deleted: await store.deleteMemory(id) });
      }
      if (request.method === "DELETE" && url.pathname === "/api/messages") {
        await store.clearMessages(url.searchParams.get("channel"));
        return sendJson(response, 200, { cleared: true });
      }
      if (request.method === "POST" && url.pathname === "/api/messages/import") {
        const body = await readJsonBody(request);
        const messages = await store.importMessages(body.messages);
        return sendJson(response, 200, { messages });
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        return sendJson(response, 200, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/api/stop") {
        const body = await readJsonBody(request);
        const sessionId = clean(body.sessionId);
        const runKey = ["kimi", "gen"].includes(body.channel) ? `${body.channel}:${sessionId}` : sessionId;
        const controller = activeRuns.get(runKey);
        if (controller) controller.abort("user_stop");
        return sendJson(response, 200, { stopped: Boolean(controller) });
      }
      if (request.method === "POST" && url.pathname === "/api/kimi/key") {
        if (!kimiKeyFile) return sendJson(response, 503, { error: "服务器未配置 Kimi Key 存储位置" });
        const body = await readJsonBody(request);
        const apiKey = clean(body.apiKey).slice(0, 1_000);
        if (apiKey.length < 8) return sendJson(response, 400, { error: "Kimi API Key 格式不正确" });
        await writeStoredKimiKey(kimiKeyFile, apiKey);
        return sendJson(response, 200, { configured: true });
      }
      if (request.method === "POST" && url.pathname === "/api/kimi/chat") {
        const body = await readJsonBody(request, 36_000_000);
        return await handleKimiPrivate(request, response, body, activeRuns, env, store, fetchImpl, kimiKeyFile, embeddings, kimiAutoMemory, uploadDir, kimiTools);
      }
      if (request.method === "POST" && url.pathname === "/api/gen/chat") {
        if (!genPrivateEnabled) return sendJson(response, 503, { error: "Gen 本地通道尚未启用" });
        const body = await readJsonBody(request, 36_000_000);
        return await handleGenPrivate(request, response, body, activeRuns, env, store, embeddings, genGenerate, uploadDir);
      }
      if (request.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJsonBody(request, 36_000_000);
        return await handleChat(request, response, body, configuredProviders, activeRuns, env, store, uploadDir);
      }
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/uploads/")) {
        return await serveUpload(request, response, url.pathname, uploadDir);
      }
      if (request.method === "GET" || request.method === "HEAD") {
        return await serveStatic(request, response, url.pathname);
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (!response.headersSent) sendJson(response, error?.statusCode || 500, { error: error?.message || "Server error" });
      else response.end();
    }
  });
}

async function handleKimiPrivate(request, response, body, activeRuns, env, store, fetchImpl, kimiKeyFile, embeddings, kimiAutoMemory, uploadDir, kimiTools) {
  const sessionId = clean(body.sessionId) || globalThis.crypto.randomUUID();
  const runKey = `kimi:${sessionId}`;
  const text = clean(body.text).slice(0, 8_000);
  if (!text && (!Array.isArray(body.images) || !body.images.length)) return sendJson(response, 400, { error: "消息不能为空" });
  if (activeRuns.has(runKey)) return sendJson(response, 409, { error: "Kimi 还在回复上一条消息" });
  const apiKey = clean(request.headers["x-kimi-api-key"])
    || clean(env.MOONSHOT_API_KEY)
    || await readStoredKimiKey(kimiKeyFile);
  if (!apiKey) return sendJson(response, 400, { error: "请先输入 Kimi API Key" });

  const savedImages = await saveIncomingImages(body.images, uploadDir);
  if (!text && !savedImages.length) return sendJson(response, 400, { error: "消息不能为空" });
  const attachments = publicAttachments(savedImages);
  const snapshot = await store.getSnapshot();
  const history = snapshot.messages.filter((message) => message.channel === "kimi");
  const relevantMemories = await findKimiMemories(store, text || "用户发送的图片", embeddings);
  const now = new Date().toISOString();
  const userMessage = {
    id: globalThis.crypto.randomUUID(),
    role: "user",
    author: "用户",
    channel: "kimi",
    content: text,
    attachments,
    readAt: now,
    createdAt: now,
  };
  await store.addMessage(userMessage);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("timeout"),
    positiveInt(env.MODEL_TIMEOUT_SECONDS, 120, 5, 300) * 1000,
  );
  activeRuns.set(runKey, controller);
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-content-type-options": "nosniff",
  });
  const write = (event) => {
    if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
  };
  write({ type: "accepted", sessionId, message: userMessage });
  write({ type: "read", messageId: userMessage.id, readAt: now });

  const disconnect = () => {
    if (!response.writableEnded) controller.abort("client_disconnected");
  };
  request.once("aborted", disconnect);
  response.once("close", disconnect);
  let completedExchange = null;
  try {
    const result = await streamKimiPrivate({
      fetchImpl,
      apiKey,
      model: clean(env.KIMI_PRIVATE_MODEL) || clean(env.KIMI_MODEL) || "kimi-k3",
      baseUrl: clean(env.KIMI_BASE_URL) || "https://api.moonshot.cn/v1",
      history,
      memories: relevantMemories,
      prompt: text,
      sentAt: now,
      images: savedImages,
      toolRegistry: kimiTools,
      maxTokens: positiveInt(env.KIMI_PRIVATE_MAX_TOKENS || env.MAX_OUTPUT_TOKENS, 2400, 200, 8000),
      temperature: boundedNumber(env.KIMI_TEMPERATURE, 1, 0, 2),
      topP: boundedNumber(env.KIMI_TOP_P, 0.95, 0, 1),
      signal: controller.signal,
      onEvent: write,
    });
    const message = {
      id: globalThis.crypto.randomUUID(),
      role: "assistant",
      providerId: "kimi",
      author: "Kimi",
      channel: "kimi",
      model: result.model,
      content: result.content,
      reasoning: result.reasoning,
      toolCalls: result.toolCalls,
      replyToId: userMessage.id,
      createdAt: new Date().toISOString(),
    };
    await store.addMessage(message);
    write({ type: "message", message });
    completedExchange = { userText: text || "用户发送了图片", assistantText: result.content };
    write({ type: "chat_done", reason: "complete" });
  } catch (error) {
    if (controller.signal.aborted) write({ type: "chat_done", reason: controller.signal.reason === "user_stop" ? "stopped" : "interrupted" });
    else write({ type: "run_error", message: error?.message || String(error) });
  } finally {
    clearTimeout(timeout);
    activeRuns.delete(runKey);
    request.off("aborted", disconnect);
    response.off("close", disconnect);
    response.end();
  }
  if (kimiAutoMemory && completedExchange) {
    setImmediate(() => runKimiMemoryMaintenance({
      env, store, embeddings, fetchImpl, apiKey, ...completedExchange,
    }));
  }
}

async function runKimiMemoryMaintenance({ env, store, embeddings, fetchImpl, apiKey, userText, assistantText }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), 60_000);
  try {
    const allMemories = (await store.listMemories({ namespace: "kimi", limit: 100 })).map(publicMemory);
    const actions = await decideKimiMemoryActions({
      fetchImpl,
      apiKey,
      model: clean(env.KIMI_PRIVATE_MODEL) || clean(env.KIMI_MODEL) || "kimi-k3",
      baseUrl: clean(env.KIMI_BASE_URL) || "https://api.moonshot.cn/v1",
      userText,
      assistantText,
      memories: allMemories,
      temperature: boundedNumber(env.KIMI_TEMPERATURE, 1, 0, 2),
      topP: boundedNumber(env.KIMI_TOP_P, 0.95, 0, 1),
      signal: controller.signal,
    });
    for (const action of actions) {
      await applyPrivateMemoryAction(store, embeddings, action, "kimi", "kimi-auto");
    }
  } catch (error) {
    console.warn(`Kimi memory curator: ${error?.message || error}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function handleGenPrivate(request, response, body, activeRuns, env, store, embeddings, genGenerate, uploadDir) {
  const sessionId = clean(body.sessionId) || globalThis.crypto.randomUUID();
  const runKey = `gen:${sessionId}`;
  const text = clean(body.text).slice(0, 8_000);
  if (activeRuns.has(runKey)) return sendJson(response, 409, { error: "Gen 还在回复上一条消息" });
  const savedImages = await saveIncomingImages(body.images, uploadDir);
  if (!text && !savedImages.length) return sendJson(response, 400, { error: "消息不能为空" });
  const attachments = publicAttachments(savedImages);

  const snapshot = await store.getSnapshot();
  const history = snapshot.messages.filter((message) => message.channel === "gen");
  const relevantMemories = await findPrivateMemories(store, text || "用户发送的图片", embeddings, ["g", "shared"], 16);
  const now = new Date().toISOString();
  const userMessage = {
    id: globalThis.crypto.randomUUID(),
    role: "user",
    author: "用户",
    channel: "gen",
    content: text,
    attachments,
    readAt: now,
    createdAt: now,
  };
  await store.addMessage(userMessage);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("timeout"),
    positiveInt(env.GEN_TIMEOUT_SECONDS || env.MODEL_TIMEOUT_SECONDS, 180, 10, 600) * 1000,
  );
  activeRuns.set(runKey, controller);
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-content-type-options": "nosniff",
  });
  const write = (event) => {
    if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
  };
  write({ type: "accepted", sessionId, message: userMessage });
  write({ type: "read", messageId: userMessage.id, readAt: now });
  const disconnect = () => {
    if (!response.writableEnded) controller.abort("client_disconnected");
  };
  request.once("aborted", disconnect);
  response.once("close", disconnect);
  try {
    const result = await genGenerate({
      command: clean(env.GEN_PRIVATE_COMMAND) || "codex",
      model: clean(env.GEN_PRIVATE_MODEL) || "gpt-5.6-sol",
      reasoningEffort: clean(env.GEN_REASONING_EFFORT) || "medium",
      runtimeDir: clean(env.GEN_RUNTIME_DIR) || ".roundtable/gen-runtime",
      history,
      memories: relevantMemories.map(publicMemory),
      prompt: text || "请看我发送的图片。",
      sentAt: now,
      images: savedImages,
      signal: controller.signal,
      onEvent: write,
    });
    const message = {
      id: globalThis.crypto.randomUUID(),
      role: "assistant",
      providerId: "gen",
      author: "Gen",
      channel: "gen",
      model: result.model,
      content: result.content,
      toolCalls: result.toolCalls,
      replyToId: userMessage.id,
      createdAt: new Date().toISOString(),
    };
    await store.addMessage(message);
    write({ type: "message", message });
    for (const action of result.memoryActions || []) {
      const change = await applyPrivateMemoryAction(store, embeddings, action, "g", "gen-auto");
      if (change) write({ type: "memory_changed", ...change });
    }
    write({ type: "chat_done", reason: "complete" });
  } catch (error) {
    if (controller.signal.aborted) write({ type: "chat_done", reason: controller.signal.reason === "user_stop" ? "stopped" : "interrupted" });
    else write({ type: "run_error", message: error?.message || String(error) });
  } finally {
    clearTimeout(timeout);
    activeRuns.delete(runKey);
    request.off("aborted", disconnect);
    response.off("close", disconnect);
    response.end();
  }
}

async function findKimiMemories(store, query, embeddings) {
  return findPrivateMemories(store, query, embeddings, ["kimi", "shared"], 10);
}

async function findPrivateMemories(store, query, embeddings, namespaces, totalLimit) {
  const queryVector = await embedSafe(embeddings, query);
  const groups = await Promise.all(namespaces.map(async (namespace) => {
    const matches = await store.listMemories({ query, namespace, limit: totalLimit, queryVector });
    return matches.length ? matches : store.listMemories({ namespace, limit: Math.min(4, totalLimit) });
  }));
  const known = new Set();
  return groups.flat().filter((memory) => {
    if (known.has(memory.id)) return false;
    known.add(memory.id);
    return true;
  }).slice(0, totalLimit);
}

async function handleChat(request, response, body, providers, activeRuns, env, store, uploadDir) {
  const sessionId = clean(body.sessionId) || globalThis.crypto.randomUUID();
  const text = clean(body.text).slice(0, 8_000);
  if (activeRuns.has(sessionId)) return sendJson(response, 409, { error: "群里已有一条 AI 回复链正在运行" });
  const savedImages = await saveIncomingImages(body.images, uploadDir);
  if (!text && !savedImages.length) return sendJson(response, 400, { error: "消息不能为空" });
  const attachments = publicAttachments(savedImages);

  const snapshot = await store.getSnapshot();
  const history = snapshot.messages;
  const userMessage = {
    id: globalThis.crypto.randomUUID(),
    role: "user",
    author: "用户",
    content: text,
    attachments,
    createdAt: new Date().toISOString(),
  };
  await store.addMessage(userMessage);
  const controller = new AbortController();
  activeRuns.set(sessionId, controller);

  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-content-type-options": "nosniff",
  });
  const write = (event) => {
    if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(event)}\n`);
  };
  write({ type: "accepted", sessionId, message: userMessage });

  const disconnect = () => {
    if (!response.writableEnded) controller.abort("client_disconnected");
  };
  request.once("aborted", disconnect);
  response.once("close", disconnect);

  try {
    await runGroupChat({
      providers,
      participantIds: Array.isArray(body.participants) ? body.participants : [],
      history: [...history, userMessage],
      images: savedImages,
      memories: snapshot.memories,
      autoRelay: body.autoRelay !== false,
      maxMessages: body.maxMessages,
      timeoutMs: positiveInt(env.MODEL_TIMEOUT_SECONDS, 120, 5, 300) * 1000,
      signal: controller.signal,
      onEvent: async (event) => {
        if (event.type === "message" && event.message) await store.addMessage(event.message);
        write(event);
      },
    });
  } catch (error) {
    write({ type: "run_error", message: error?.message || String(error) });
  } finally {
    activeRuns.delete(sessionId);
    request.off("aborted", disconnect);
    response.off("close", disconnect);
    response.end();
  }
}

async function serveUpload(request, response, pathname, uploadDir) {
  const filename = path.basename(decodeURIComponent(pathname.slice("/uploads/".length)));
  if (!filename || filename !== decodeURIComponent(pathname.slice("/uploads/".length))) {
    return sendJson(response, 403, { error: "Forbidden" });
  }
  const filePath = path.resolve(uploadDir, filename);
  if (!filePath.startsWith(`${uploadDir}${path.sep}`)) return sendJson(response, 403, { error: "Forbidden" });
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeType(filePath),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else response.end(content);
  } catch (error) {
    if (error?.code === "ENOENT") return sendJson(response, 404, { error: "Not found" });
    throw error;
  }
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname === "/g-memory" ? "/g-memory.html" : pathname;
  const decoded = decodeURIComponent(requested);
  const filePath = path.resolve(publicDir, `.${decoded}`);
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
    return sendJson(response, 403, { error: "Forbidden" });
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeType(filePath),
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else response.end(content);
  } catch (error) {
    if (error?.code === "ENOENT") return sendJson(response, 404, { error: "Not found" });
    throw error;
  }
}

async function applyPrivateMemoryAction(store, embeddings, action, namespace, source) {
  const owner = namespace === "g" ? "Gen" : "Kimi";
  if (action.type === "create") {
    const memory = await store.addMemory({
      text: action.text,
      namespace,
      tags: action.tags,
      importance: action.importance,
      source,
      metadata: { reason: action.reason || `${owner} 自主整理` },
      vectorStatus: embeddings ? "pending" : "not_indexed",
    });
    const indexed = await indexMemorySafe(store, embeddings, memory);
    return { action: "created", memory: publicMemory(indexed || memory) };
  }
  if (action.type === "update") {
    const snapshot = await store.getSnapshot();
    const existing = snapshot.memories.find((item) => item.id === action.id && item.namespace === namespace);
    if (!existing) return null;
    const memory = await store.updateMemory(action.id, {
      text: action.text,
      tags: action.tags,
      importance: action.importance,
      metadata: {
        ...existing.metadata,
        lastMaintainedBy: owner,
        reason: action.reason || `${owner} 自主整理`,
      },
    });
    if (!memory || memory.namespace !== namespace) return null;
    const indexed = await indexMemorySafe(store, embeddings, memory);
    return { action: "updated", memory: publicMemory(indexed || memory) };
  }
  if (action.type === "delete") {
    const snapshot = await store.getSnapshot();
    const memory = snapshot.memories.find((item) => item.id === action.id && item.namespace === namespace);
    if (!memory || !await store.deleteMemory(action.id)) return null;
    return { action: "deleted", memory: publicMemory(memory) };
  }
  return null;
}

async function indexMemorySafe(store, embeddings, memory) {
  if (!embeddings || !memory?.id || !clean(memory.text)) return memory;
  try {
    const embedding = await embeddings.embed(memory.text);
    return await store.setMemoryEmbedding(memory.id, { embedding, model: embeddings.model });
  } catch (error) {
    console.warn(`Memory vector indexing: ${error?.message || error}`);
    return memory;
  }
}

async function embedSafe(embeddings, text) {
  if (!embeddings || !clean(text)) return [];
  try { return await embeddings.embed(text); }
  catch (error) {
    console.warn(`Memory vector search: ${error?.message || error}`);
    return [];
  }
}

function publicSnapshot(snapshot) {
  return { ...snapshot, memories: (snapshot.memories || []).map(publicMemory) };
}

function publicMemory(memory) {
  if (!memory) return memory;
  const { embedding, ...safe } = memory;
  return safe;
}

function readJsonBody(request, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        const error = new Error("请求内容过大");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch {
        const error = new Error("JSON 格式无效");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  if (response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(payload));
}

function mimeType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function positiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseBoolean(value, fallback = false) {
  const normalized = clean(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

async function readStoredKimiKey(filePath) {
  if (!filePath) return "";
  try {
    return clean(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function writeStoredKimiKey(filePath, apiKey) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${clean(apiKey)}\n`, { encoding: "utf8", mode: 0o600 });
}

function isAuthorized(request, expectedTokens) {
  const authorization = clean(request.headers.authorization);
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  const provided = bearer || clean(request.headers["x-roundtable-token"]);
  if (!provided) return false;
  return expectedTokens.some((expectedToken) => {
    const providedBytes = Buffer.from(provided);
    const expectedBytes = Buffer.from(expectedToken);
    if (providedBytes.length !== expectedBytes.length) return false;
    return timingSafeEqual(providedBytes, expectedBytes);
  });
}

function getMemoryScope(request, accessToken, gptMemoryToken, publicAccess = false) {
  const authorization = clean(request.headers.authorization);
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  const provided = bearer || clean(request.headers["x-roundtable-token"]);
  if (accessToken && safeTokenEqual(provided, accessToken)) return "all";
  if (gptMemoryToken && safeTokenEqual(provided, gptMemoryToken)) return "g";
  if (publicAccess) return "all";
  return "";
}

function safeTokenEqual(provided, expected) {
  if (!provided || !expected) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

async function listGMemories(store, { query, limit, queryVector = [] }) {
  const cappedLimit = positiveInt(limit, 50, 1, 200);
  const [g, legacy] = await Promise.all([
    store.listMemories({ query, namespace: "g", limit: cappedLimit, queryVector }),
    store.listMemories({ query, namespace: "gpt", limit: cappedLimit, queryVector }),
  ]);
  return [...g, ...legacy]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, cappedLimit);
}

async function isGMemory(store, id) {
  const snapshot = await store.getSnapshot();
  const memory = snapshot.memories.find((item) => item.id === id);
  return Boolean(memory && ["g", "gpt"].includes(memory.namespace));
}

function createMemoryOpenApi({ request, env }) {
  const forwardedHost = clean(request.headers["x-forwarded-host"]);
  const host = forwardedHost || clean(request.headers.host) || "localhost:8787";
  const forwardedProto = clean(request.headers["x-forwarded-proto"]).split(",")[0];
  const protocol = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const serverUrl = clean(env.PUBLIC_BASE_URL).replace(/\/$/, "") || `${protocol}://${host}`;
  const memoryProperties = {
    id: { type: "string", description: "Stable memory ID" },
    text: { type: "string", maxLength: 4000, description: "The durable fact, preference, decision, or context" },
    namespace: { type: "string", default: "g", description: "Use g for G老师 memories. Legacy gpt memories remain readable." },
    tags: { type: "array", items: { type: "string" }, maxItems: 20 },
    importance: { type: "integer", minimum: 1, maximum: 5, default: 3 },
    source: { type: "string", default: "chatgpt" },
    metadata: { type: "object", additionalProperties: true },
    vectorStatus: { type: "string", enum: ["not_indexed", "pending", "indexed"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  };
  const writableMemory = {
    type: "object",
    required: ["text"],
    properties: {
      text: memoryProperties.text,
      namespace: memoryProperties.namespace,
      tags: memoryProperties.tags,
      importance: memoryProperties.importance,
      source: memoryProperties.source,
      metadata: memoryProperties.metadata,
    },
  };
  const memorySchema = {
    type: "object",
    properties: memoryProperties,
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "LIVING ROOM GPT Memory",
      version: "1.0.0",
      description: "A private long-term memory service shared by ChatGPT and a multi-AI group chat.",
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/memories": {
        get: {
          operationId: "searchMemories",
          summary: "Search or list G老师 long-term memories before answering",
          parameters: [
            { name: "query", in: "query", schema: { type: "string" }, description: "Keywords to search; omit to list recent memories" },
            { name: "namespace", in: "query", schema: { type: "string" }, description: "Use g; legacy gpt is also supported" },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 20 } },
          ],
          responses: { 200: { description: "Matching memories", content: { "application/json": { schema: { type: "object", properties: { memories: { type: "array", items: { $ref: "#/components/schemas/Memory" } } } } } } } },
        },
        post: {
          operationId: "createMemory",
          summary: "Save a durable G老师 memory after the user asks or confirms it",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/WritableMemory" } } } },
          responses: { 201: { description: "Memory saved" } },
        },
      },
      "/api/memories/{id}": {
        patch: {
          operationId: "updateMemory",
          summary: "Correct or enrich an existing memory",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { ...writableMemory, required: [] } } } },
          responses: { 200: { description: "Memory updated" }, 404: { description: "Memory not found" } },
        },
        delete: {
          operationId: "deleteMemory",
          summary: "Delete a memory when the user explicitly requests forgetting it",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Deletion result" } },
        },
      },
    },
    components: {
      schemas: {
        Memory: memorySchema,
        WritableMemory: writableMemory,
      },
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = positiveInt(process.env.PORT, 8787, 1, 65535);
  const host = clean(process.env.HOST) || "127.0.0.1";
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`LIVING ROOM is running at http://${host}:${port}`);
    if (!["127.0.0.1", "localhost", "::1"].includes(host) && !clean(process.env.ROUNDTABLE_ACCESS_TOKEN)) {
      console.warn("Warning: LAN access is enabled without ROUNDTABLE_ACCESS_TOKEN.");
    }
  });
}
