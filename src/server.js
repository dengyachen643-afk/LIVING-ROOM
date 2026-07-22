import http from "node:http";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { createProviders } from "./providers.js";
import { createGroupDedupeRegistry, HARD_MAX_CHAIN_MESSAGES, MAX_REPLIES_PER_MEMBER, runGroupChat } from "./groupchat.js";
import { streamKimiPrivate } from "./kimi-private.js";
import { streamGlmPrivate } from "./glm-private.js";
import { decideKimiMemoryActions } from "./kimi-memory.js";
import { decideGlmMemoryActions } from "./glm-memory.js";
import { KimiFormulaTools } from "./kimi-tools.js";
import { generateGenPrivate } from "./gen-private.js";
import { DEFAULT_EMBEDDING_MODEL, LocalEmbeddingService } from "./embeddings.js";
import { RoundtableStore } from "./store.js";
import { publicAttachments, removePublicUpload, saveIncomingImages } from "./uploads.js";
import { createProactiveScheduler } from "./proactive.js";
import { recallOlderConversation } from "./conversation-recall.js";
import { MomentsStore } from "./moments-store.js";
import { createMomentsService } from "./moments-service.js";
import { normalizeQuote, quotePromptLine } from "./quote-context.js";
import { retrievePromptMemories } from "./memory-retrieval.js";
import { memberIdForProvider, memberRoundsAsMessages } from "./member-rounds.js";
import { createMemoryReviewCoordinator } from "./memory-review-coordinator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

export function createServer({
  env = process.env,
  providers,
  store = new RoundtableStore({
    filePath: clean(env.ROUNDTABLE_STATE_FILE) || ".roundtable/state.json",
    archiveFilePath: clean(env.CHAT_HISTORY_DB_FILE) || undefined,
  }),
  fetchImpl = globalThis.fetch,
  embeddingService,
  genGenerate = generateGenPrivate,
  glmStream = streamGlmPrivate,
  kimiToolRegistry,
  momentsStore: injectedMomentsStore,
  momentsService: injectedMomentsService,
} = {}) {
  const activeRuns = new Map();
  const groupDedupeRegistry = createGroupDedupeRegistry();
  const memoryBatches = new Map();
  const accessToken = clean(env.ROUNDTABLE_ACCESS_TOKEN);
  const gptMemoryToken = clean(env.GPT_MEMORY_TOKEN);
  const publicAccess = parseBoolean(env.ROUNDTABLE_PUBLIC_ACCESS, false);
  const kimiKeyFile = clean(env.KIMI_KEY_FILE) ? path.resolve(clean(env.KIMI_KEY_FILE)) : "";
  const glmKeyFile = clean(env.GLM_KEY_FILE) ? path.resolve(clean(env.GLM_KEY_FILE)) : "";
  const providerEnv = { ...env };
  if (!clean(providerEnv.MOONSHOT_API_KEY) && kimiKeyFile) {
    try { providerEnv.MOONSHOT_API_KEY = clean(readFileSync(kimiKeyFile, "utf8")); }
    catch { /* private setup can still configure it later */ }
  }
  if (!clean(providerEnv.GLM_API_KEY) && glmKeyFile) {
    try { providerEnv.GLM_API_KEY = clean(readFileSync(glmKeyFile, "utf8")); }
    catch { /* private setup can still configure it later */ }
  }
  const configuredProviders = providers || createProviders(providerEnv);
  const vectorEnabled = parseBoolean(env.MEMORY_VECTOR_ENABLED, false);
  const kimiAutoMemory = parseBoolean(env.KIMI_AUTO_MEMORY, false);
  const glmAutoMemory = parseBoolean(env.GLM_AUTO_MEMORY, true);
  const groupAutoMemory = parseBoolean(env.GROUP_AUTO_MEMORY, false);
  const kimiToolsEnabled = parseBoolean(env.KIMI_TOOLS_ENABLED, false);
  const genPrivateEnabled = parseBoolean(env.GEN_PRIVATE_ENABLED, false);
  const genWorkEnabled = parseBoolean(env.GEN_WORK_ENABLED, false);
  const genWorkspaces = buildGenWorkspaces(env);
  const uploadDir = path.resolve(clean(env.UPLOAD_DIR) || ".roundtable/uploads");
  const kimiTools = kimiToolRegistry || (kimiToolsEnabled ? new KimiFormulaTools({ fetchImpl }) : null);
  const embeddings = embeddingService || (vectorEnabled ? new LocalEmbeddingService({
    model: clean(env.MEMORY_EMBEDDING_MODEL) || DEFAULT_EMBEDDING_MODEL,
    cacheDir: clean(env.MEMORY_MODEL_CACHE) || ".roundtable/models",
    remoteHost: clean(env.HF_ENDPOINT),
  }) : null);
  const proactiveScheduler = createProactiveScheduler({
    env,
    providers: configuredProviders,
    store,
    activeRuns,
    embeddings,
  });
  const configuredMomentsDb = clean(env.MOMENTS_DB_FILE);
  const momentsDbFile = configuredMomentsDb
    ? path.resolve(configuredMomentsDb)
    : store.filePath
      ? path.join(path.dirname(store.filePath), "moments.sqlite")
      : ":memory:";
  const momentsStore = injectedMomentsStore || new MomentsStore({ filePath: momentsDbFile });
  const momentsService = injectedMomentsService || createMomentsService({
    env: providerEnv,
    momentsStore,
    chatStore: store,
    providers: configuredProviders,
    embeddings,
    fetchImpl,
    uploadDir,
    activeRuns,
  });
  const memoryReviews = createMemoryReviewCoordinator({
    providers: configuredProviders,
    store,
    embeddings,
  });

  const server = http.createServer(async (request, response) => {
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
        const storedGlmKey = await readStoredApiKey(glmKeyFile);
        return sendJson(response, 200, {
          providers: configuredProviders.map(({ id, label, kind, model, available, unavailableReason }) => ({
            id, label, kind, model, available, unavailableReason,
          })),
          limits: {
            maxChainMessages: HARD_MAX_CHAIN_MESSAGES,
            maxRepliesPerMember: MAX_REPLIES_PER_MEMBER,
          },
          memory: {
            storage: "server",
            longTerm: true,
            vectorEnabled: Boolean(embeddings),
            embeddingModel: embeddings?.model || "",
            kimiAutoMemory,
            glmAutoMemory,
            groupAutoMemory,
          },
          uploads: { enabled: true, maxImages: 4, maxImageBytes: 6_000_000 },
          tools: { kimi: Boolean(kimiTools), glm: true, gen: true },
          publicAccess,
          kimiPrivate: {
            model: clean(env.KIMI_PRIVATE_MODEL) || clean(env.KIMI_MODEL) || "kimi-k2.5",
            envKeyAvailable: Boolean(clean(env.MOONSHOT_API_KEY) || storedKimiKey),
            acceptsSessionKey: true,
            persistsServerKey: Boolean(kimiKeyFile),
          },
          glmPrivate: {
            enabled: parseBoolean(env.GLM_PRIVATE_ENABLED, true),
            model: clean(env.GLM_MODEL) || "glm-5.1",
            visionModel: clean(env.GLM_VISION_MODEL) || "glm-5v-turbo",
            envKeyAvailable: Boolean(clean(env.GLM_API_KEY) || storedGlmKey),
            acceptsSessionKey: true,
            persistsServerKey: Boolean(glmKeyFile),
          },
          genPrivate: {
            enabled: genPrivateEnabled,
            model: clean(env.GEN_PRIVATE_MODEL) || "gpt-5.6-sol",
            workEnabled: genWorkEnabled,
            workspaces: genWorkspaces.map(({ id, label }) => ({ id, label })),
          },
          proactive: proactiveScheduler.getPublicConfig(),
          moments: momentsService.getPublicConfig(),
        });
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        return sendJson(response, 200, publicSnapshot(await store.getSnapshot()));
      }
      if (request.method === "GET" && url.pathname === "/api/ui-state") {
        return sendJson(response, 200, publicUiSnapshot(await store.getSnapshot()));
      }
      if (request.method === "GET" && url.pathname === "/api/sync") {
        const snapshot = await store.getSnapshot();
        const since = clean(url.searchParams.get("since"));
        const messages = since
          ? snapshot.messages.filter((message) => String(message.createdAt || "") >= since)
          : snapshot.messages.slice(-80);
        return sendJson(response, 200, {
          messages,
          avatars: snapshot.avatars || {},
          signatures: snapshot.signatures || {},
          chatBackgrounds: snapshot.chatBackgrounds || {},
        });
      }
      if (request.method === "GET" && url.pathname === "/api/history") {
        const aroundId = clean(url.searchParams.get("around"));
        const query = clean(url.searchParams.get("query"));
        const channel = clean(url.searchParams.get("channel"));
        const member = clean(url.searchParams.get("member"));
        if (aroundId) {
          const entries = await store.getArchivedMessageContext(aroundId, url.searchParams.get("radius") || 24);
          return sendJson(response, 200, { entries });
        }
        if (query || member) {
          const entries = await store.searchArchivedMessages({ query, channel, member, limit: url.searchParams.get("limit") || 50 });
          return sendJson(response, 200, { entries, query, channel, member });
        }
        const result = await store.listArchivedMessages({
          channel,
          before: url.searchParams.get("before") || "",
          limit: url.searchParams.get("limit") || 60,
        });
        return sendJson(response, 200, result);
      }
      if (request.method === "GET" && url.pathname === "/api/moments") {
        const result = momentsStore.listMoments({
          cursor: url.searchParams.get("cursor") || "",
          since: url.searchParams.get("since") || "",
          limit: url.searchParams.get("limit") || 20,
        });
        return sendJson(response, 200, {
          ...result,
          coverUrl: momentsStore.getSetting("cover_url"),
          serverTime: new Date().toISOString(),
        });
      }
      if (request.method === "POST" && url.pathname === "/api/moments") {
        const body = await readJsonBody(request, 36_000_000);
        const requestedId = safeClientMessageId(body.id);
        const existing = requestedId ? momentsStore.getMoment(requestedId) : null;
        if (existing) return sendJson(response, 200, { moment: existing });
        const savedImages = await saveIncomingImages(body.images, uploadDir, { maxFiles: 4, maxBytes: 6_000_000 });
        const moment = await momentsService.createUserMoment({
          id: requestedId,
          content: clean(body.content).slice(0, 8_000),
          images: publicAttachments(savedImages),
        });
        return sendJson(response, 201, { moment });
      }
      if (request.method === "PUT" && url.pathname === "/api/moments/cover") {
        const body = await readJsonBody(request, 10_000_000);
        const [saved] = await saveIncomingImages([body.image], uploadDir, { maxFiles: 1, maxBytes: 6_000_000 });
        if (!saved) return sendJson(response, 400, { error: "请选择一张封面图片" });
        const previous = momentsStore.getSetting("cover_url");
        const coverUrl = momentsStore.setSetting("cover_url", saved.url);
        if (previous && previous !== coverUrl) await removePublicUpload(previous, uploadDir);
        return sendJson(response, 200, { coverUrl });
      }
      if (request.method === "DELETE" && url.pathname === "/api/moments/cover") {
        const previous = momentsStore.getSetting("cover_url");
        momentsStore.deleteSetting("cover_url");
        if (previous) await removePublicUpload(previous, uploadDir);
        return sendJson(response, 200, { coverUrl: "" });
      }
      const momentCommentMatch = url.pathname.match(/^\/api\/moments\/([^/]+)\/comments$/u);
      if (request.method === "POST" && momentCommentMatch) {
        const body = await readJsonBody(request);
        const moment = await momentsService.createUserComment(decodeURIComponent(momentCommentMatch[1]), {
          content: clean(body.content).slice(0, 4_000),
          replyToCommentId: clean(body.replyToCommentId),
        });
        return sendJson(response, 201, { moment });
      }
      const momentLikeMatch = url.pathname.match(/^\/api\/moments\/([^/]+)\/like$/u);
      if (request.method === "POST" && momentLikeMatch) {
        const body = await readJsonBody(request);
        const moment = momentsService.setUserLike(decodeURIComponent(momentLikeMatch[1]), body.liked !== false);
        return sendJson(response, 200, { moment });
      }
      if (request.method === "PUT" && url.pathname.startsWith("/api/avatars/")) {
        const avatarId = url.pathname.slice("/api/avatars/".length).toLowerCase();
        if (!["okra", "gen", "kimi", "glm", "k"].includes(avatarId)) return sendJson(response, 404, { error: "没有这个成员" });
        const body = await readJsonBody(request, 10_000_000);
        const [saved] = await saveIncomingImages([body.image], uploadDir, { maxFiles: 1, maxBytes: 6_000_000 });
        if (!saved) return sendJson(response, 400, { error: "请选择头像图片" });
        const avatar = await store.setAvatar(avatarId, saved.url);
        if (avatar.previous && avatar.previous !== avatar.url) await removePublicUpload(avatar.previous, uploadDir);
        return sendJson(response, 200, { avatar: { id: avatar.id, url: avatar.url } });
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/api/avatars/")) {
        const avatarId = url.pathname.slice("/api/avatars/".length).toLowerCase();
        if (!["okra", "gen", "kimi", "glm", "k"].includes(avatarId)) return sendJson(response, 404, { error: "没有这个成员" });
        const avatar = await store.deleteAvatar(avatarId);
        if (avatar?.previous) await removePublicUpload(avatar.previous, uploadDir);
        return sendJson(response, 200, { deleted: Boolean(avatar) });
      }
      const profileSignatureMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/signature$/u);
      if (request.method === "PUT" && profileSignatureMatch) {
        const profileId = decodeURIComponent(profileSignatureMatch[1]).toLowerCase();
        if (!["okra", "gen", "kimi", "glm", "k"].includes(profileId)) return sendJson(response, 404, { error: "没有这个成员" });
        const body = await readJsonBody(request);
        const profile = await store.setProfileSignature(profileId, body.signature);
        return sendJson(response, 200, { profile });
      }
      if (request.method === "PUT" && url.pathname.startsWith("/api/chat-backgrounds/")) {
        const channel = url.pathname.slice("/api/chat-backgrounds/".length).toLowerCase();
        if (!["group", "gen", "kimi", "glm"].includes(channel)) return sendJson(response, 404, { error: "没有这个聊天" });
        const body = await readJsonBody(request, 10_000_000);
        const [saved] = await saveIncomingImages([body.image], uploadDir, { maxFiles: 1, maxBytes: 6_000_000 });
        if (!saved) return sendJson(response, 400, { error: "请选择一张聊天背景" });
        const background = await store.setChatBackground(channel, saved.url);
        if (background.previous && background.previous !== background.url) await removePublicUpload(background.previous, uploadDir);
        return sendJson(response, 200, { background: { channel: background.channel, url: background.url } });
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/api/chat-backgrounds/")) {
        const channel = url.pathname.slice("/api/chat-backgrounds/".length).toLowerCase();
        if (!["group", "gen", "kimi", "glm"].includes(channel)) return sendJson(response, 404, { error: "没有这个聊天" });
        const background = await store.deleteChatBackground(channel);
        if (background?.previous) await removePublicUpload(background.previous, uploadDir);
        return sendJson(response, 200, { deleted: Boolean(background), channel });
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
        const runKey = ["kimi", "gen", "glm"].includes(body.channel) ? `${body.channel}:${sessionId}` : sessionId;
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
        return await handleKimiPrivate(
          request, response, body, activeRuns, env, store, fetchImpl, kimiKeyFile,
          embeddings, kimiAutoMemory, uploadDir, kimiTools, memoryBatches, memoryReviews,
        );
      }
      if (request.method === "GET" && url.pathname === "/api/kimi/status") {
        const sessionId = clean(url.searchParams.get("sessionId"));
        const messageId = clean(url.searchParams.get("messageId"));
        const snapshot = await store.getSnapshot();
        const message = [...snapshot.messages].reverse().find((item) => (
          item.role === "assistant" && item.channel === "kimi" && item.replyToId === messageId
        ));
        const knownUser = snapshot.messages.some((item) => item.role === "user" && item.channel === "kimi" && item.id === messageId);
        return sendJson(response, 200, {
          running: Boolean(sessionId && activeRuns.has(`kimi:${sessionId}`)),
          knownUser,
          message: message || null,
        });
      }
      if (request.method === "POST" && url.pathname === "/api/glm/key") {
        if (!glmKeyFile) return sendJson(response, 503, { error: "服务器未配置 GLM Key 存储位置" });
        const body = await readJsonBody(request);
        const apiKey = clean(body.apiKey).slice(0, 2_000);
        if (apiKey.length < 8) return sendJson(response, 400, { error: "GLM API Key 格式不正确" });
        await writeStoredApiKey(glmKeyFile, apiKey);
        return sendJson(response, 200, { configured: true });
      }
      if (request.method === "POST" && url.pathname === "/api/glm/chat") {
        if (!parseBoolean(env.GLM_PRIVATE_ENABLED, true)) return sendJson(response, 503, { error: "GLM 私聊尚未启用" });
        const body = await readJsonBody(request, 36_000_000);
        return await handleGlmPrivate(
          request, response, body, activeRuns, env, store, fetchImpl, glmKeyFile,
          embeddings, uploadDir, glmStream, glmAutoMemory, memoryBatches, memoryReviews,
        );
      }
      if (request.method === "GET" && url.pathname === "/api/glm/status") {
        const sessionId = clean(url.searchParams.get("sessionId"));
        const messageId = clean(url.searchParams.get("messageId"));
        const snapshot = await store.getSnapshot();
        const message = [...snapshot.messages].reverse().find((item) => (
          item.role === "assistant" && item.channel === "glm" && item.replyToId === messageId
        ));
        const knownUser = snapshot.messages.some((item) => item.role === "user" && item.channel === "glm" && item.id === messageId);
        return sendJson(response, 200, {
          running: Boolean(sessionId && activeRuns.has(`glm:${sessionId}`)),
          knownUser,
          message: message || null,
        });
      }
      if (request.method === "GET" && url.pathname === "/api/gen/status") {
        const sessionId = clean(url.searchParams.get("sessionId"));
        const messageId = clean(url.searchParams.get("messageId"));
        const snapshot = await store.getSnapshot();
        const message = [...snapshot.messages].reverse().find((item) => (
          item.role === "assistant" && item.channel === "gen" && item.replyToId === messageId
        ));
        const knownUser = snapshot.messages.some((item) => item.role === "user" && item.channel === "gen" && item.id === messageId);
        return sendJson(response, 200, {
          running: Boolean(sessionId && activeRuns.has(`gen:${sessionId}`)),
          knownUser,
          message: message || null,
        });
      }
      if (request.method === "POST" && url.pathname === "/api/gen/guide") {
        if (!genPrivateEnabled) return sendJson(response, 503, { error: "Gen 本地通道尚未启用" });
        const body = await readJsonBody(request);
        return await handleGenGuidance(response, body, activeRuns, store);
      }
      if (request.method === "POST" && url.pathname === "/api/gen/chat") {
        if (!genPrivateEnabled) return sendJson(response, 503, { error: "Gen 本地通道尚未启用" });
        const body = await readJsonBody(request, 36_000_000);
        return await handleGenPrivate(
          request, response, body, activeRuns, env, store, embeddings, genGenerate, uploadDir,
          { enabled: genWorkEnabled, workspaces: genWorkspaces },
          memoryReviews,
        );
      }
      if (request.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJsonBody(request, 36_000_000);
        return await handleChat(
          request, response, body, configuredProviders, activeRuns, env, store,
          uploadDir, embeddings, fetchImpl, kimiKeyFile, glmKeyFile, groupAutoMemory, memoryBatches,
          groupDedupeRegistry, memoryReviews,
        );
      }
      if (request.method === "GET" && url.pathname === "/api/group/status") {
        const sessionId = clean(url.searchParams.get("sessionId"));
        const messageId = clean(url.searchParams.get("messageId"));
        const snapshot = await store.getSnapshot();
        const knownUser = messageId
          ? snapshot.messages.some((item) => item.role === "user" && item.channel === "group" && item.id === messageId)
          : false;
        return sendJson(response, 200, {
          running: Boolean(sessionId && activeRuns.has(sessionId)),
          knownUser,
        });
      }
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/uploads/")) {
        return await serveUpload(request, response, url.pathname, uploadDir, url.searchParams);
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
  proactiveScheduler.start();
  momentsService.start();
  memoryReviews.start().catch((error) => console.warn(`[memory-review:start] ${error?.message || error}`));
  server.once("close", () => {
    proactiveScheduler.stop();
    momentsService.stop();
    memoryReviews.stop();
    store.close?.();
  });
  return server;
}

async function handleGlmPrivate(
  request, response, body, activeRuns, env, store, fetchImpl, glmKeyFile,
  embeddings, uploadDir, glmStream, glmAutoMemory, memoryBatches, memoryReviews,
) {
  const sessionId = clean(body.sessionId) || globalThis.crypto.randomUUID();
  const runKey = `glm:${sessionId}`;
  const text = clean(body.text).slice(0, 8_000);
  if (!text && (!Array.isArray(body.images) || !body.images.length)) return sendJson(response, 400, { error: "消息不能为空" });
  if (activeRuns.has(runKey)) return sendJson(response, 409, { error: "GLM 还在回复上一条消息" });
  abortProactiveRuns(activeRuns, new Set(["glm"]));
  const apiKey = clean(request.headers["x-glm-api-key"])
    || clean(env.GLM_API_KEY)
    || await readStoredApiKey(glmKeyFile);
  if (!apiKey) return sendJson(response, 400, { error: "请先输入 GLM API Key" });

  const savedImages = await saveIncomingImages(body.images, uploadDir);
  if (!text && !savedImages.length) return sendJson(response, 400, { error: "消息不能为空" });
  const attachments = publicAttachments(savedImages);
  const quote = normalizeQuote(body.quote);
  const snapshot = await store.getSnapshot();
  // GLM keeps one continuous recent context across its private chat and the
  // room. The serializer preserves the real speaker for every room message.
  const ownRounds = await store.listMemberRounds("glm", { limit: 30 });
  const history = ownRounds.length
    ? memberRoundsAsMessages(ownRounds, "Shin")
    : snapshot.messages.filter((message) => ["glm", "group"].includes(message.channel));
  const memories = await findPrivateMemories(
    store, text || "用户发送的图片", embeddings, ["glm", "shared"], 8, ownRounds.map((round) => round.id),
  );
  const now = new Date().toISOString();
  const userMessage = {
    id: safeClientMessageId(body.messageId) || globalThis.crypto.randomUUID(),
    role: "user",
    author: "Okra",
    channel: "glm",
    content: text,
    attachments,
    quote,
    readAt: now,
    createdAt: now,
  };
  await store.addMessage(userMessage);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("timeout"),
    positiveInt(env.GLM_TIMEOUT_SECONDS || env.MODEL_TIMEOUT_SECONDS, 300, 10, 600) * 1000,
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
  write({ type: "typing", author: "Shin" });
  let completedExchange = null;
  try {
    const result = await glmStream({
      fetchImpl,
      apiKey,
      model: clean(env.GLM_MODEL) || "glm-5.1",
      visionModel: clean(env.GLM_VISION_MODEL) || "glm-5v-turbo",
      baseUrl: clean(env.GLM_BASE_URL) || "https://open.bigmodel.cn/api/paas/v4",
      history,
      memories,
      prompt: text,
      quote,
      sentAt: now,
      images: savedImages,
      signal: controller.signal,
      onEvent: write,
    });
    const message = {
      id: globalThis.crypto.randomUUID(),
      role: "assistant",
      providerId: "glm",
      author: "Shin",
      channel: "glm",
      model: result.model,
      content: result.content,
      reasoning: result.reasoning,
      toolCalls: result.toolCalls || [],
      replyToId: userMessage.id,
      createdAt: new Date().toISOString(),
    };
    await store.addMessage(message);
    await memoryReviews?.record("glm", { scene: "private", trigger: userMessage, response: message });
    write({ type: "message", message });
    completedExchange = { userText: text || "用户发送了图片", assistantText: result.content };
    write({ type: "chat_done", reason: "complete" });
  } catch (error) {
    const reason = controller.signal.reason;
    if (reason === "user_stop") {
      write({ type: "chat_done", reason: "stopped" });
    } else {
      const detail = clean(error?.message || String(error)).slice(0, 1_000);
      const content = reason === "timeout" ? "这次回复超时了，可以重新发我一下。" : `这次没有回复成功：${detail || "GLM 接口暂时没有返回结果"}`;
      const message = {
        id: globalThis.crypto.randomUUID(), role: "assistant", providerId: "glm", author: "Shin", channel: "glm",
        model: clean(env.GLM_MODEL) || "glm-5.1", content, reasoning: "", toolCalls: [],
        replyToId: userMessage.id, createdAt: new Date().toISOString(),
      };
      await store.addMessage(message);
      write({ type: "message", message });
      write({ type: "chat_done", reason: "failed" });
    }
  } finally {
    clearTimeout(timeout);
    activeRuns.delete(runKey);
    if (!response.destroyed && !response.writableEnded) response.end();
  }
  if (glmAutoMemory && completedExchange && hasExplicitMemoryIntent(completedExchange.userText)) {
    const batch = enqueueMemoryBatch(
      memoryBatches,
      "glm-private",
      completedExchange,
      positiveInt(env.GLM_MEMORY_BATCH_SIZE, 6, 2, 20),
      hasExplicitMemoryIntent(completedExchange.userText),
    );
    if (batch) {
      const exchange = combinePrivateMemoryBatch(batch, "Shin");
      setImmediate(() => runGlmMemoryMaintenance({
        env, store, embeddings, fetchImpl, apiKey, ...exchange,
      }));
    }
  }
}

async function handleKimiPrivate(
  request, response, body, activeRuns, env, store, fetchImpl, kimiKeyFile,
  embeddings, kimiAutoMemory, uploadDir, kimiTools, memoryBatches, memoryReviews,
) {
  const sessionId = clean(body.sessionId) || globalThis.crypto.randomUUID();
  const runKey = `kimi:${sessionId}`;
  const text = clean(body.text).slice(0, 8_000);
  if (!text && (!Array.isArray(body.images) || !body.images.length)) return sendJson(response, 400, { error: "消息不能为空" });
  if (activeRuns.has(runKey)) return sendJson(response, 409, { error: "Kimi 还在回复上一条消息" });
  abortProactiveRuns(activeRuns, new Set(["kimi"]));
  const apiKey = clean(request.headers["x-kimi-api-key"])
    || clean(env.MOONSHOT_API_KEY)
    || await readStoredKimiKey(kimiKeyFile);
  if (!apiKey) return sendJson(response, 400, { error: "请先输入 Kimi API Key" });

  const savedImages = await saveIncomingImages(body.images, uploadDir);
  if (!text && !savedImages.length) return sendJson(response, 400, { error: "消息不能为空" });
  const attachments = publicAttachments(savedImages);
  const quote = normalizeQuote(body.quote);
  const snapshot = await store.getSnapshot();
  const ownRounds = await store.listMemberRounds("kimi", { limit: 30 });
  const history = ownRounds.length
    ? memberRoundsAsMessages(ownRounds, "Kimi")
    : snapshot.messages.filter((message) => ["kimi", "group"].includes(message.channel));
  const relevantMemories = await findKimiMemories(
    store, text || "用户发送的图片", embeddings, ownRounds.map((round) => round.id),
  );
  const now = new Date().toISOString();
  const userMessage = {
    id: safeClientMessageId(body.messageId) || globalThis.crypto.randomUUID(),
    role: "user",
    author: "用户",
    channel: "kimi",
    content: text,
    attachments,
    quote,
    readAt: now,
    createdAt: now,
  };
  await store.addMessage(userMessage);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("timeout"),
    positiveInt(env.KIMI_TIMEOUT_SECONDS || env.MODEL_TIMEOUT_SECONDS, 300, 10, 600) * 1000,
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
  write({ type: "typing", author: "Kimi" });

  let completedExchange = null;
  try {
    const result = await streamKimiPrivate({
      fetchImpl,
      apiKey,
      model: clean(env.KIMI_PRIVATE_MODEL) || clean(env.KIMI_MODEL) || "kimi-k2.5",
      baseUrl: clean(env.KIMI_BASE_URL) || "https://api.moonshot.cn/v1",
      history,
      memories: relevantMemories,
      prompt: text,
      quote,
      sentAt: now,
      images: savedImages,
      toolRegistry: kimiTools,
      reasoningEffort: clean(env.KIMI_REASONING_EFFORT) || "medium",
      thinkingEnabled: false,
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
    await memoryReviews?.record("kimi", { scene: "private", trigger: userMessage, response: message });
    write({ type: "message", message });
    completedExchange = { userText: text || "用户发送了图片", assistantText: result.content };
    write({ type: "chat_done", reason: "complete" });
  } catch (error) {
    const reason = controller.signal.reason;
    if (reason === "user_stop") {
      write({ type: "chat_done", reason: "stopped" });
    } else {
      const detail = clean(error?.message || String(error)).slice(0, 1_000);
      const content = reason === "timeout"
        ? "这次回复超时了。你可以重新发我一下，我再接着回。"
        : `这次没有回复成功：${detail || "Kimi 接口暂时没有返回结果"}`;
      const failureMessage = {
        id: globalThis.crypto.randomUUID(),
        role: "assistant",
        providerId: "kimi",
        author: "Kimi",
        channel: "kimi",
        model: clean(env.KIMI_PRIVATE_MODEL) || clean(env.KIMI_MODEL) || "kimi-k2.5",
        content,
        reasoning: "",
        toolCalls: [],
        replyToId: userMessage.id,
        createdAt: new Date().toISOString(),
      };
      await store.addMessage(failureMessage);
      write({ type: "message", message: failureMessage });
      write({ type: "chat_done", reason: "failed" });
    }
  } finally {
    clearTimeout(timeout);
    activeRuns.delete(runKey);
    if (!response.destroyed && !response.writableEnded) response.end();
  }
  if (kimiAutoMemory && completedExchange && hasExplicitMemoryIntent(completedExchange.userText)) {
    const batch = enqueueMemoryBatch(
      memoryBatches,
      "kimi-private",
      completedExchange,
      positiveInt(env.KIMI_MEMORY_BATCH_SIZE, 6, 2, 20),
      hasExplicitMemoryIntent(completedExchange.userText),
    );
    if (batch) {
      const exchange = combinePrivateMemoryBatch(batch);
      setImmediate(() => runKimiMemoryMaintenance({
        env, store, embeddings, fetchImpl, apiKey, ...exchange,
      }));
    }
  }
}

async function runKimiMemoryMaintenance({ env, store, embeddings, fetchImpl, apiKey, userText, assistantText }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), 60_000);
  try {
    const allMemories = (await findPrivateMemories(
      store, userText, embeddings, ["kimi"], 16,
    )).map(publicMemory);
    const actions = await decideKimiMemoryActions({
      fetchImpl,
      apiKey,
      model: clean(env.KIMI_MEMORY_MODEL) || "moonshot-v1-8k",
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

async function runGlmMemoryMaintenance({
  env, store, embeddings, fetchImpl, apiKey, userText, assistantText,
  scene = "私聊", source = "glm-auto",
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), 60_000);
  try {
    const allMemories = (await findPrivateMemories(
      store, userText, embeddings, ["glm"], 16,
    )).map(publicMemory);
    const actions = await decideGlmMemoryActions({
      fetchImpl,
      apiKey,
      model: clean(env.GLM_MEMORY_MODEL) || clean(env.GLM_MODEL) || "glm-5.1",
      baseUrl: clean(env.GLM_BASE_URL) || "https://open.bigmodel.cn/api/paas/v4",
      userText,
      assistantText,
      memories: allMemories,
      ownerName: "Shin",
      scene,
      temperature: boundedNumber(env.GLM_MEMORY_TEMPERATURE, 0.3, 0, 2),
      topP: boundedNumber(env.GLM_MEMORY_TOP_P, 0.7, 0, 1),
      signal: controller.signal,
    });
    for (const action of actions) {
      await applyPrivateMemoryAction(store, embeddings, action, "glm", source);
    }
  } catch (error) {
    console.warn(`GLM memory curator: ${error?.message || error}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function runGroupMemoryMaintenance({
  env, store, embeddings, fetchImpl, kimiApiKey, glmApiKey, userText, exchanges,
}) {
  const grouped = new Map();
  for (const exchange of exchanges.slice(0, 8)) {
    const namespace = memoryNamespaceForProvider(exchange.providerId);
    if (!namespace) continue;
    const current = grouped.get(namespace) || { ...exchange, content: "" };
    current.content = [current.content, exchange.content].filter(Boolean).join("\n");
    grouped.set(namespace, current);
  }
  await Promise.all([...grouped.entries()].map(async ([namespace, exchange]) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), 60_000);
    try {
      const memories = (await findPrivateMemories(
        store, userText, embeddings, [namespace], 16,
      )).map(publicMemory);
      const isGlm = namespace === "glm";
      const apiKey = isGlm ? glmApiKey : kimiApiKey;
      if (!apiKey) return;
      const actions = isGlm
        ? await decideGlmMemoryActions({
            fetchImpl,
            apiKey,
            model: clean(env.GLM_MEMORY_MODEL) || clean(env.GLM_MODEL) || "glm-5.1",
            baseUrl: clean(env.GLM_BASE_URL) || "https://open.bigmodel.cn/api/paas/v4",
            userText,
            assistantText: exchange.content,
            memories,
            ownerName: "Shin",
            scene: "LIVING ROOM 群聊",
            temperature: boundedNumber(env.GLM_MEMORY_TEMPERATURE, 0.3, 0, 2),
            topP: boundedNumber(env.GLM_MEMORY_TOP_P, 0.7, 0, 1),
            signal: controller.signal,
          })
        : await decideKimiMemoryActions({
            fetchImpl,
            apiKey,
            model: clean(env.KIMI_MEMORY_MODEL) || "moonshot-v1-8k",
            baseUrl: clean(env.KIMI_BASE_URL) || "https://api.moonshot.cn/v1",
            userText,
            assistantText: exchange.content,
            memories,
            ownerName: exchange.author,
            scene: "LIVING ROOM 群聊",
            signal: controller.signal,
          });
      for (const action of actions) {
        await applyPrivateMemoryAction(store, embeddings, action, namespace, `${namespace}-group-auto`);
      }
    } catch (error) {
      console.warn(`${exchange.author || "Group member"} group memory curator: ${error?.message || error}`);
    } finally {
      clearTimeout(timeout);
    }
  }));
}

async function handleGenPrivate(
  request, response, body, activeRuns, env, store, embeddings, genGenerate, uploadDir,
  genWork = { enabled: false, workspaces: [] }, memoryReviews,
) {
  const sessionId = clean(body.sessionId) || globalThis.crypto.randomUUID();
  const runKey = `gen:${sessionId}`;
  const text = clean(body.text).slice(0, 8_000);
  const mode = body.mode === "work" ? "work" : "chat";
  const workspace = mode === "work"
    ? genWork.workspaces.find((item) => item.id === clean(body.workspaceId))
    : null;
  if (mode === "work" && !genWork.enabled) return sendJson(response, 403, { error: "Gen 干活模式尚未启用" });
  if (mode === "work" && !workspace) return sendJson(response, 400, { error: "请选择允许 Gen 操作的工作区" });
  if (activeRuns.has(runKey)) return sendJson(response, 409, { error: "Gen 还在回复上一条消息" });
  abortProactiveRuns(activeRuns, new Set(["openai", "codex-cli"]));
  const savedImages = await saveIncomingImages(body.images, uploadDir);
  if (!text && !savedImages.length) return sendJson(response, 400, { error: "消息不能为空" });
  const attachments = publicAttachments(savedImages);
  const quote = normalizeQuote(body.quote);

  const snapshot = await store.getSnapshot();
  // Gen has one continuous recent context across its private chat and the room.
  // The prompt serializer keeps each room speaker's real identity so another
  // model's words are never mistaken for Gen's own words.
  const ownRounds = await store.listMemberRounds("g", { limit: 30 });
  const history = ownRounds.length
    ? memberRoundsAsMessages(ownRounds, "Gen")
    : snapshot.messages.filter((message) => ["gen", "group"].includes(message.channel));
  const recalledHistory = await recallOlderConversation({ history, query: text, embeddings });
  const relevantMemories = await findPrivateMemories(
    store, text || "用户发送的图片", embeddings, ["g", "shared"], 8, ownRounds.map((round) => round.id),
  );
  const now = new Date().toISOString();
  const userMessage = {
    id: safeClientMessageId(body.messageId) || globalThis.crypto.randomUUID(),
    role: "user",
    author: "用户",
    channel: "gen",
    content: text,
    attachments,
    quote,
    mode,
    workspaceId: workspace?.id || "",
    workspaceLabel: workspace?.label || "",
    readAt: now,
    createdAt: now,
  };
  await store.addMessage(userMessage);

  const controller = new AbortController();
  controller.genWork = mode === "work";
  controller.acceptingGuidance = mode === "work";
  controller.guidance = [];
  controller.workspace = workspace || null;
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
  try {
    const generate = ({ runHistory, runPrompt, runSentAt, runImages = [] }) => genGenerate({
      command: clean(env.GEN_PRIVATE_COMMAND) || "codex",
      model: clean(env.GEN_PRIVATE_MODEL) || "gpt-5.6-sol",
      reasoningEffort: mode === "work"
        ? clean(env.GEN_WORK_REASONING_EFFORT) || "high"
        : clean(env.GEN_REASONING_EFFORT) || "medium",
      runtimeDir: clean(env.GEN_RUNTIME_DIR) || ".roundtable/gen-runtime",
      mode,
      workspaceDir: workspace?.directory || "",
      workspaceLabel: workspace?.label || "",
      windowsSandbox: clean(env.GEN_WINDOWS_SANDBOX) || "unelevated",
      history: runHistory,
      recalledHistory,
      memories: relevantMemories.map(publicMemory),
      prompt: runPrompt,
      quote,
      sentAt: runSentAt,
      images: runImages,
      signal: controller.signal,
      onEvent: write,
    });
    let result = await generate({
      runHistory: history,
      runPrompt: text || "请看我发送的图片。",
      runSentAt: now,
      runImages: savedImages,
    });
    while (mode === "work") {
      // Give queued HTTP guidance a chance to arrive before closing the task.
      await new Promise((resolve) => setImmediate(resolve));
      const queued = controller.guidance.splice(0);
      if (!queued.length) {
        controller.acceptingGuidance = false;
        break;
      }
      const latest = await store.getSnapshot();
      const guidanceText = queued.map((item) => `- [${item.sentAt}] ${item.text}`).join("\n");
      result = await generate({
        runHistory: latest.messages.filter((message) => ["gen", "group"].includes(message.channel)),
        runPrompt: `小O在你执行任务期间补充了以下指令。不要把它们当成新任务另起炉灶；请在现有工作成果上继续检查、调整并完成原任务。\n${guidanceText}`,
        runSentAt: queued.at(-1).sentAt,
      });
    }
    const message = {
      id: globalThis.crypto.randomUUID(),
      role: "assistant",
      providerId: "gen",
      author: "Gen",
      channel: "gen",
      model: result.model,
      content: result.content,
      toolCalls: result.toolCalls,
      mode,
      workspaceId: workspace?.id || "",
      workspaceLabel: workspace?.label || "",
      replyToId: userMessage.id,
      createdAt: new Date().toISOString(),
    };
    await store.addMessage(message);
    await memoryReviews?.record("g", { scene: "private", trigger: userMessage, response: message });
    write({ type: "message", message });
    for (const action of result.memoryActions || []) {
      const change = await applyPrivateMemoryAction(store, embeddings, action, "g", "gen-auto");
      if (change) write({ type: "memory_changed", ...change });
    }
    write({ type: "chat_done", reason: "complete" });
  } catch (error) {
    if (mode === "work") {
      const reason = controller.signal.reason;
      const content = reason === "user_stop"
        ? "任务已停止。"
        : reason === "timeout"
          ? "任务没有完成：运行时间超过限制。你可以把任务拆小一点再交给我，或者让我继续处理其中一部分。"
          : `任务没有完成：${clean(error?.message || String(error)).slice(0, 1_200)}`;
      const failureMessage = {
        id: globalThis.crypto.randomUUID(),
        role: "assistant",
        providerId: "gen",
        author: "Gen",
        channel: "gen",
        model: clean(env.GEN_PRIVATE_MODEL) || "gpt-5.6-sol",
        content,
        toolCalls: [],
        mode,
        workspaceId: workspace?.id || "",
        workspaceLabel: workspace?.label || "",
        replyToId: userMessage.id,
        createdAt: new Date().toISOString(),
      };
      await store.addMessage(failureMessage);
      write({ type: "message", message: failureMessage });
      write({ type: "chat_done", reason: reason === "user_stop" ? "stopped" : "failed" });
    } else if (controller.signal.aborted) {
      write({ type: "chat_done", reason: controller.signal.reason === "user_stop" ? "stopped" : "interrupted" });
    } else write({ type: "run_error", message: error?.message || String(error) });
  } finally {
    controller.acceptingGuidance = false;
    clearTimeout(timeout);
    activeRuns.delete(runKey);
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

async function handleGenGuidance(response, body, activeRuns, store) {
  const sessionId = clean(body.sessionId);
  const text = clean(body.text).slice(0, 8_000);
  if (!text) return sendJson(response, 400, { error: "补充指令不能为空" });
  const controller = activeRuns.get(`gen:${sessionId}`);
  if (!controller?.genWork || !controller.acceptingGuidance) {
    return sendJson(response, 409, { error: "Gen 当前没有可追加指令的任务" });
  }
  const now = new Date().toISOString();
  const quote = normalizeQuote(body.quote);
  const workspace = controller.workspace;
  const message = {
    id: safeClientMessageId(body.messageId) || globalThis.crypto.randomUUID(),
    role: "user",
    author: "用户",
    channel: "gen",
    content: text,
    attachments: [],
    quote,
    mode: "guide",
    workspaceId: workspace?.id || "",
    workspaceLabel: workspace?.label || "",
    readAt: now,
    createdAt: now,
  };
  await store.addMessage(message);
  controller.guidance.push({
    messageId: message.id,
    text: [quotePromptLine(quote, "Okra"), text].filter(Boolean).join("\n"),
    sentAt: now,
  });
  return sendJson(response, 202, { accepted: true, message });
}

function safeClientMessageId(value) {
  const id = clean(value);
  return /^[A-Za-z0-9_-]{8,100}$/u.test(id) ? id : "";
}

function buildGenWorkspaces(env) {
  const projectDirectory = path.resolve(clean(env.GEN_PROJECT_DIR) || process.cwd());
  const generalDirectory = path.resolve(
    clean(env.GEN_WORKSPACE_DIR) || path.join(path.dirname(projectDirectory), "Gen-Workspace"),
  );
  return [
    { id: "living-room", label: "LIVING ROOM", directory: projectDirectory },
    { id: "gen-workspace", label: "Gen 工作区", directory: generalDirectory },
  ];
}

async function findKimiMemories(store, query, embeddings, excludeSourceRoundIds = []) {
  return findPrivateMemories(store, query, embeddings, ["kimi", "shared"], 8, excludeSourceRoundIds);
}

function memoryNamespaceForProvider(providerId) {
  if (providerId === "kimi") return "kimi";
  if (providerId === "glm") return "glm";
  if (["openai", "codex-cli", "gen"].includes(providerId)) return "g";
  if (["anthropic", "claude-code", "k"].includes(providerId)) return "k";
  return "";
}

async function findPrivateMemories(store, query, embeddings, namespaces, totalLimit, excludeSourceRoundIds = []) {
  return retrievePromptMemories({
    store,
    embeddings,
    query,
    namespaces,
    candidateLimit: Math.max(20, totalLimit * 2),
    limit: totalLimit,
    charBudget: totalLimit <= 8 ? 1_200 : 4_000,
    excludeSourceRoundIds,
  });
}

async function handleChat(
  request, response, body, providers, activeRuns, env, store, uploadDir,
  embeddings, fetchImpl, kimiKeyFile, glmKeyFile, groupAutoMemory, memoryBatches,
  groupDedupeRegistry, memoryReviews,
) {
  const sessionId = clean(body.sessionId) || globalThis.crypto.randomUUID();
  const text = clean(body.text).slice(0, 8_000);
  if (activeRuns.has(sessionId)) return sendJson(response, 409, { error: "群里已有一条 AI 回复链正在运行" });
  abortProactiveRuns(activeRuns);
  const savedImages = await saveIncomingImages(body.images, uploadDir);
  if (!text && !savedImages.length) return sendJson(response, 400, { error: "消息不能为空" });
  const attachments = publicAttachments(savedImages);
  const quote = normalizeQuote(body.quote);

  const snapshot = await store.getSnapshot();
  const history = snapshot.messages.filter((message) => message.channel === "group");
  const [kimiRounds, glmRounds, genRounds, kRounds] = await Promise.all([
    store.listMemberRounds("kimi", { limit: 30 }),
    store.listMemberRounds("glm", { limit: 30 }),
    store.listMemberRounds("g", { limit: 30 }),
    store.listMemberRounds("k", { limit: 30 }),
  ]);
  const privateContextByProvider = {
    kimi: kimiRounds.length ? memberRoundsAsMessages(kimiRounds, "Kimi") : snapshot.messages.filter((message) => message.channel === "kimi").slice(-24),
    glm: glmRounds.length ? memberRoundsAsMessages(glmRounds, "Shin") : snapshot.messages.filter((message) => message.channel === "glm").slice(-24),
    openai: genRounds.length ? memberRoundsAsMessages(genRounds, "Gen") : snapshot.messages.filter((message) => message.channel === "gen").slice(-24),
    "codex-cli": genRounds.length ? memberRoundsAsMessages(genRounds, "Gen") : snapshot.messages.filter((message) => message.channel === "gen").slice(-24),
    anthropic: memberRoundsAsMessages(kRounds, "K"),
    "claude-code": memberRoundsAsMessages(kRounds, "K"),
  };
  const roundIdsByMember = { kimi: kimiRounds, glm: glmRounds, g: genRounds, k: kRounds };
  const requestedParticipants = new Set(Array.isArray(body.participants) ? body.participants : []);
  const memoriesByProvider = Object.fromEntries(await Promise.all(
    providers
      .filter((provider) => requestedParticipants.has(provider.id))
      .map(async (provider) => [
        provider.id,
        await findPrivateMemories(
          store,
          text || "Okra 在群聊中发送了图片",
          embeddings,
          [memoryNamespaceForProvider(provider.id), "shared"].filter(Boolean),
          8,
          (roundIdsByMember[memoryNamespaceForProvider(provider.id)] || []).map((round) => round.id),
        ),
      ]),
  ));
  const userMessage = {
    id: safeClientMessageId(body.messageId) || globalThis.crypto.randomUUID(),
    role: "user",
    author: "Okra",
    channel: "group",
    content: text,
    attachments,
    quote,
    createdAt: new Date().toISOString(),
  };
  await store.addMessage(userMessage);
  const controller = new AbortController();
  controller.groupRun = true;
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

  const completedExchanges = [];

  try {
    await runGroupChat({
      providers,
      participantIds: Array.isArray(body.participants) ? body.participants : [],
      history: [...history, userMessage],
      privateContextByProvider,
      images: savedImages,
      memories: snapshot.memories,
      memoriesByProvider,
      autoRelay: body.autoRelay !== false,
      maxMessages: body.maxMessages,
      timeoutMs: positiveInt(env.MODEL_TIMEOUT_SECONDS, 120, 5, 300) * 1000,
      dedupeRegistry: groupDedupeRegistry,
      signal: controller.signal,
      onEvent: async (event) => {
        if (event.type === "message" && event.message) {
          event.message.channel = "group";
          await store.addMessage(event.message);
          completedExchanges.push(event.message);
          await memoryReviews?.record(memberIdForProvider(event.message.providerId), {
            scene: "group", trigger: event.trigger, response: event.message,
          });
        }
        if (event.type === "speaker_skip" && event.reason !== "duplicate") {
          await memoryReviews?.record(memberIdForProvider(event.provider?.id), {
            scene: "group",
            trigger: event.trigger,
            response: { id: "", author: event.provider?.label, content: "", createdAt: new Date().toISOString() },
            skipped: true,
            key: `group-skip:${event.provider?.id}:${event.trigger?.id}`,
          });
        }
        write(event);
      },
    });
  } catch (error) {
    write({ type: "run_error", message: error?.message || String(error) });
  } finally {
    activeRuns.delete(sessionId);
    if (!response.destroyed && !response.writableEnded) response.end();
  }
  if (groupAutoMemory && completedExchanges.length && hasExplicitMemoryIntent(text)) {
    const kimiApiKey = clean(env.MOONSHOT_API_KEY) || await readStoredKimiKey(kimiKeyFile);
    const glmApiKey = clean(env.GLM_API_KEY) || await readStoredApiKey(glmKeyFile);
    if (kimiApiKey || glmApiKey) {
      const batch = enqueueMemoryBatch(
        memoryBatches,
        "group",
        { userText: text || "user sent images", exchanges: completedExchanges },
        positiveInt(env.GROUP_MEMORY_BATCH_SIZE, 4, 2, 20),
        hasExplicitMemoryIntent(text),
      );
      if (!batch) return;
      setImmediate(() => runGroupMemoryMaintenance({
        env,
        store,
        embeddings,
        fetchImpl,
        kimiApiKey,
        glmApiKey,
        userText: text || "用户发送了图片",
        exchanges: completedExchanges,
        ...combineGroupMemoryBatch(batch),
      }));
    }
  }
}

async function serveUpload(request, response, pathname, uploadDir, searchParams = new URLSearchParams()) {
  const filename = path.basename(decodeURIComponent(pathname.slice("/uploads/".length)));
  if (!filename || filename !== decodeURIComponent(pathname.slice("/uploads/".length))) {
    return sendJson(response, 403, { error: "Forbidden" });
  }
  const filePath = path.resolve(uploadDir, filename);
  if (!filePath.startsWith(`${uploadDir}${path.sep}`)) return sendJson(response, 403, { error: "Forbidden" });
  try {
    const requestedWidth = Number.parseInt(searchParams.get("w") || "", 10);
    const width = Number.isFinite(requestedWidth) && requestedWidth >= 64 && requestedWidth <= 1600
      ? requestedWidth
      : 0;
    const sourceType = mimeType(filePath);
    const thumbnail = width > 0 && sourceType.startsWith("image/") && sourceType !== "image/gif";
    const content = thumbnail
      ? await readOrCreateThumbnail(filePath, filename, uploadDir, width)
      : await readFile(filePath);
    response.writeHead(200, {
      "content-type": thumbnail ? "image/webp" : sourceType,
      "content-length": content.length,
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

async function readOrCreateThumbnail(filePath, filename, uploadDir, width) {
  const thumbnailDir = path.join(uploadDir, ".thumbs");
  const thumbnailPath = path.join(thumbnailDir, `${filename}.${width}.webp`);
  try {
    return await readFile(thumbnailPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const content = await sharp(filePath)
    .rotate()
    .resize({ width, withoutEnlargement: true, fit: "inside" })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  await mkdir(thumbnailDir, { recursive: true });
  await writeFile(thumbnailPath, content);
  return content;
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "/index.html"
    : pathname === "/g-memory" ? "/g-memory.html"
      : pathname === "/moments" ? "/moments.html" : pathname;
  const decoded = decodeURIComponent(requested);
  const filePath = path.resolve(publicDir, `.${decoded}`);
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
    return sendJson(response, 403, { error: "Forbidden" });
  }
  try {
    const content = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const immutableAsset = extension === ".woff2";
    const revalidatingAsset = [".css", ".js"].includes(extension);
    const cacheControl = immutableAsset
      ? "public, max-age=31536000, immutable"
      : revalidatingAsset
        ? "public, max-age=0, must-revalidate"
        : "no-store, must-revalidate";
    const etag = `"${createHash("sha256").update(content).digest("base64url").slice(0, 20)}"`;
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304, {
        etag,
        "cache-control": cacheControl,
        "x-content-type-options": "nosniff",
      });
      return response.end();
    }
    response.writeHead(200, {
      "content-type": mimeType(filePath),
      "content-length": content.length,
      "cache-control": cacheControl,
      etag,
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
  const owner = namespace === "g" ? "Gen" : namespace === "glm" ? "Shin" : namespace === "k" ? "K" : "Kimi";
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
  const { shortTermMemories, eventMemories, memberRounds, memoryReviewCursors, ...publicState } = snapshot;
  return {
    ...publicState,
    messages: recentMessagesByChannel(snapshot.messages || [], 60),
    memories: (snapshot.memories || []).map(publicMemory),
  };
}

function recentMessagesByChannel(messages, limitPerChannel) {
  const counts = new Map();
  const selected = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const channel = message.channel || "group";
    const count = counts.get(channel) || 0;
    if (count >= limitPerChannel) continue;
    counts.set(channel, count + 1);
    selected.push(message);
  }
  return selected.reverse();
}

function publicUiSnapshot(snapshot) {
  const latestAssistantByChannel = new Map();
  for (const message of snapshot.messages || []) {
    if (message.role !== "assistant" || message.pending) continue;
    latestAssistantByChannel.set(message.channel || "group", message);
  }
  return {
    avatars: snapshot.avatars || {},
    signatures: snapshot.signatures || {},
    chatBackgrounds: snapshot.chatBackgrounds || {},
    messages: [...latestAssistantByChannel.values()].map((message) => ({
      id: message.id,
      role: message.role,
      providerId: message.providerId || "",
      author: message.author || "",
      channel: message.channel || "group",
      readAt: message.readAt || "",
      createdAt: message.createdAt || "",
    })),
  };
}

function publicMemory(memory) {
  if (!memory) return memory;
  const { embedding, ...safe } = memory;
  return safe;
}

function abortProactiveRuns(activeRuns, providerIds = null) {
  for (const [key, controller] of activeRuns.entries()) {
    if (!key.startsWith("proactive:")) continue;
    if (providerIds && !providerIds.has(key.slice("proactive:".length))) continue;
    controller.abort("user_message");
  }
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
  const plain = Buffer.from(JSON.stringify(payload));
  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/iu.test(String(response.req?.headers?.["accept-encoding"] || ""));
  const compressed = acceptsGzip && plain.length >= 1_024;
  const body = compressed ? gzipSync(plain, { level: 6 }) : plain;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    vary: "Accept-Encoding",
    ...(compressed ? { "content-encoding": "gzip" } : {}),
  });
  response.end(body);
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
    ".woff2": "font/woff2",
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function enqueueMemoryBatch(batches, key, item, batchSize, immediate = false) {
  const pending = [...(batches.get(key) || []), item].slice(-batchSize);
  if (!immediate && pending.length < batchSize) {
    batches.set(key, pending);
    return null;
  }
  batches.delete(key);
  return pending;
}

function combinePrivateMemoryBatch(batch, ownerName = "Kimi") {
  return {
    userText: batch.map((exchange, index) => (
      `第 ${index + 1} 轮 Okra：${memoryExcerpt(exchange.userText, 500)}`
    )).join("\n"),
    assistantText: batch.map((exchange, index) => (
      `第 ${index + 1} 轮 ${ownerName}：${memoryExcerpt(exchange.assistantText, 700)}`
    )).join("\n"),
  };
}

function combineGroupMemoryBatch(batch) {
  const grouped = new Map();
  for (const [roundIndex, round] of batch.entries()) {
    for (const exchange of Array.isArray(round.exchanges) ? round.exchanges : []) {
      const key = clean(exchange.providerId) || clean(exchange.author);
      if (!key) continue;
      const current = grouped.get(key) || { ...exchange, content: "" };
      current.content = [
        current.content,
        `第 ${roundIndex + 1} 轮：${memoryExcerpt(exchange.content, 700)}`,
      ].filter(Boolean).join("\n").slice(0, 4_000);
      grouped.set(key, current);
    }
  }
  return {
    userText: batch.map((round, index) => (
      `第 ${index + 1} 轮 Okra：${memoryExcerpt(round.userText, 500)}`
    )).join("\n"),
    exchanges: [...grouped.values()],
  };
}

function memoryExcerpt(value, length) {
  return clean(value).slice(0, length);
}

function hasExplicitMemoryIntent(value) {
  return /(?:记住|记一下|记下来|保存|别忘|不要忘|忘掉|忘记|删掉|删除|清除|别再记|不再记|更正|纠正|更新(?:一下)?(?:我的)?(?:信息|偏好|记忆)?|改成)/u.test(clean(value));
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
  return readStoredApiKey(filePath);
}

async function readStoredApiKey(filePath) {
  if (!filePath) return "";
  try {
    return clean(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function writeStoredKimiKey(filePath, apiKey) {
  return writeStoredApiKey(filePath, apiKey);
}

async function writeStoredApiKey(filePath, apiKey) {
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
