const els = {
  shell: document.querySelector("#app-shell"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarClose: document.querySelector("#sidebar-close"),
  sidebarOverlay: document.querySelector("#sidebar-overlay"),
  memoryOverlay: document.querySelector("#memory-overlay"),
  memoryPanel: document.querySelector("#memory-panel"),
  memoryClose: document.querySelector("#memory-close"),
  conversations: document.querySelector(".conversation-list"),
  conversationCards: [...document.querySelectorAll("[data-chat]")],
  membersSection: document.querySelector(".members-section"),
  providerList: document.querySelector("#provider-list"),
  participantCount: document.querySelector("#participant-count"),
  turnBudget: document.querySelector("#turn-budget"),
  relayControl: document.querySelector("#relay-control"),
  relayToggle: document.querySelector("#relay-toggle"),
  mentionBar: document.querySelector("#mention-bar"),
  channelName: document.querySelector("#channel-name"),
  channelSubtitle: document.querySelector("#channel-subtitle"),
  groupAvatar: document.querySelector("#group-avatar"),
  privateAvatar: document.querySelector("#private-avatar"),
  kimiMemory: document.querySelector("#kimi-memory-button"),
  kimiSettings: document.querySelector("#kimi-settings-button"),
  kimiCardPreview: document.querySelector("#kimi-card-preview"),
  genCardPreview: document.querySelector("#gen-card-preview"),
  kimiSetup: document.querySelector("#kimi-setup"),
  kimiKeyInput: document.querySelector("#kimi-api-key"),
  chat: document.querySelector("#chat"),
  empty: document.querySelector("#empty-state"),
  emptyAvatar: document.querySelector("#empty-avatar"),
  emptyName: document.querySelector("#empty-name"),
  emptyCopy: document.querySelector("#empty-copy"),
  messages: document.querySelector("#messages"),
  composerWrap: document.querySelector("#composer-wrap"),
  composer: document.querySelector("#composer"),
  input: document.querySelector("#message-input"),
  imageInput: document.querySelector("#image-input"),
  imagePreview: document.querySelector("#image-preview"),
  attachButton: document.querySelector("#attach-button"),
  send: document.querySelector("#send-button"),
  stop: document.querySelector("#stop-button"),
  status: document.querySelector("#run-status"),
  emojiButton: document.querySelector("#emoji-button"),
  emojiPanel: document.querySelector("#emoji-panel"),
  clear: document.querySelector("#clear-button"),
  memoryTitle: document.querySelector("#memory-title"),
  memoryForm: document.querySelector("#memory-form"),
  memoryInput: document.querySelector("#memory-input"),
  memoryList: document.querySelector("#memory-list"),
  memoryCount: document.querySelector("#memory-count"),
  copyToast: document.querySelector("#copy-toast"),
};

const tokenFromUrl = new URLSearchParams(location.search).get("token");
if (tokenFromUrl) {
  sessionStorage.setItem("roundtable.accessToken", tokenFromUrl);
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete("token");
  history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}

const state = {
  sessionId: localStorage.getItem("roundtable.sessionId") || crypto.randomUUID(),
  history: readStoredHistory(),
  providers: [],
  memories: [],
  notices: [],
  selected: new Set(),
  activeChat: ["group", "kimi", "gen"].includes(localStorage.getItem("roundtable.activeChat"))
    ? localStorage.getItem("roundtable.activeChat")
    : "group",
  running: false,
  runningChannel: "",
  draft: null,
  maxChainMessages: 8,
  kimiKey: sessionStorage.getItem("kimi.apiKey") || "",
  kimiEnvAvailable: false,
  kimiModel: "kimi-k3",
  genEnabled: false,
  genModel: "gpt-5.6-sol",
  memorySyncVersion: { kimi: 0, gen: 0 },
  pendingImages: [],
};
localStorage.setItem("roundtable.sessionId", state.sessionId);

await initialize();

els.sidebarToggle.addEventListener("click", openSidebar);
els.sidebarClose.addEventListener("click", closeSidebar);
els.sidebarOverlay.addEventListener("click", closeSidebar);
els.memoryClose.addEventListener("click", closeMemoryPanel);
els.memoryOverlay.addEventListener("click", closeMemoryPanel);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSidebar();
    closeMemoryPanel();
    els.emojiPanel.hidden = true;
  }
});

els.conversations.addEventListener("click", (event) => {
  const card = event.target.closest("[data-chat]");
  if (card) setActiveChat(card.dataset.chat);
});

els.providerList.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-provider]");
  if (!input) return;
  if (input.checked) state.selected.add(input.dataset.provider);
  else state.selected.delete(input.dataset.provider);
  localStorage.setItem("roundtable.selection", JSON.stringify([...state.selected]));
  renderMentionBar();
  updateHeader();
});

els.mentionBar.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mention]");
  if (button) insertAtCursor(`@${button.dataset.mention} `);
});

els.emojiButton.addEventListener("click", () => {
  els.emojiPanel.hidden = !els.emojiPanel.hidden;
});

els.emojiPanel.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  insertAtCursor(button.textContent);
  els.emojiPanel.hidden = true;
});

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.running) return;
  const text = els.input.value.trim();
  const images = state.pendingImages.map(({ name, type, dataUrl }) => ({ name, type, dataUrl }));
  if (!text && !images.length) return;
  if (state.activeChat === "kimi") await sendKimiMessage(text, images);
  else if (state.activeChat === "gen") await sendGenMessage(text, images);
  else await sendGroupMessage(text, images);
});

els.stop.addEventListener("click", async () => {
  els.stop.disabled = true;
  els.status.textContent = "正在停止…";
  try {
    await apiFetch("/api/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: state.sessionId, channel: state.activeChat }),
    });
  } finally {
    els.stop.disabled = false;
  }
});

els.clear.addEventListener("click", async () => {
  if (state.running) return;
  const labels = { kimi: "与 Kimi 的私聊", gen: "与 Gen 的私聊", group: "客厅聊天" };
  const label = labels[state.activeChat];
  if (!confirm(`清空${label}？长期记忆不会被删除。`)) return;
  const response = await apiFetch(`/api/messages?channel=${encodeURIComponent(state.activeChat)}`, { method: "DELETE" });
  if (!response.ok) return appendSystem("聊天记录清理失败");
  state.history = state.history.filter((message) => messageChannel(message) !== state.activeChat);
  state.notices = state.notices.filter((notice) => notice.channel !== state.activeChat);
  persistHistory();
  renderHistory();
});

els.memoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.memoryInput.value.trim();
  if (!text) return;
  const response = await apiFetch("/api/memories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      namespace: memoryNamespace(state.activeChat),
      source: state.activeChat === "kimi" ? "kimi-private-ui" : state.activeChat === "gen" ? "gen-private-ui" : "group-chat-ui",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return appendSystem(payload.error || "记忆保存失败");
  const existing = state.memories.findIndex((item) => item.id === payload.memory.id);
  if (existing >= 0) state.memories[existing] = payload.memory;
  else state.memories.push(payload.memory);
  els.memoryInput.value = "";
  renderMemories();
});

els.memoryList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-memory-id]");
  if (!button) return;
  const memory = state.memories.find((item) => item.id === button.dataset.memoryId);
  const owner = state.activeChat === "kimi" ? "Kimi" : state.activeChat === "gen" ? "Gen" : "共享";
  if (!confirm(`删除这条${owner}记忆？\n\n${memory?.text || ""}`)) return;
  const response = await apiFetch(`/api/memories/${encodeURIComponent(button.dataset.memoryId)}`, { method: "DELETE" });
  if (!response.ok) return appendSystem("记忆删除失败");
  state.memories = state.memories.filter((item) => item.id !== button.dataset.memoryId);
  renderMemories();
});

els.kimiSetup.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = els.kimiKeyInput.value.trim();
  if (!apiKey) return;
  const saved = await saveKimiKeyToServer(apiKey);
  if (!saved) return;
  state.kimiKey = apiKey;
  state.kimiEnvAvailable = true;
  sessionStorage.setItem("kimi.apiKey", apiKey);
  els.kimiKeyInput.value = "";
  applyPrivateAuthState();
  updateHeader();
  renderHistory();
  els.input.focus();
});

els.kimiSettings.addEventListener("click", () => {
  els.kimiSetup.hidden = false;
  els.empty.hidden = true;
  els.kimiKeyInput.focus();
});

els.kimiMemory.addEventListener("click", () => {
  openMemoryPanel();
});

els.attachButton.addEventListener("click", () => els.imageInput.click());
els.imageInput.addEventListener("change", async () => {
  try { await addPendingImages([...els.imageInput.files]); }
  catch (error) { appendSystem(error.message || "图片读取失败"); }
  els.imageInput.value = "";
});
els.imagePreview.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-image-id]");
  if (!button) return;
  state.pendingImages = state.pendingImages.filter((image) => image.id !== button.dataset.imageId);
  renderImagePreview();
});

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    els.composer.requestSubmit();
  }
});

els.input.addEventListener("input", resizeInput);

let copyPressTimer = null;
let copyPressTarget = null;
let copyPressStart = null;
els.messages.addEventListener("pointerdown", (event) => {
  const target = event.target.closest(".message-body.copyable");
  if (!target || (event.pointerType === "mouse" && event.button !== 0)) return;
  clearCopyPress();
  copyPressTarget = target;
  copyPressStart = { x: event.clientX, y: event.clientY };
  copyPressTimer = setTimeout(() => copyMessageBubble(target), 520);
});
els.messages.addEventListener("pointermove", (event) => {
  if (!copyPressStart) return;
  if (Math.hypot(event.clientX - copyPressStart.x, event.clientY - copyPressStart.y) > 10) clearCopyPress();
});
for (const type of ["pointerup", "pointercancel", "pointerleave"]) els.messages.addEventListener(type, clearCopyPress);
els.messages.addEventListener("contextmenu", (event) => {
  const target = event.target.closest(".message-body.copyable");
  if (!target) return;
  event.preventDefault();
  clearCopyPress();
  copyMessageBubble(target);
});

async function initialize() {
  try {
    let response = await apiFetch("/api/config");
    if (response.status === 401) {
      const token = prompt("请输入群聊访问口令：")?.trim();
      if (!token) throw new Error("需要访问口令才能连接聊天。");
      sessionStorage.setItem("roundtable.accessToken", token);
      response = await apiFetch("/api/config");
    }
    if (!response.ok) throw new Error("无法读取聊天配置");
    const config = await response.json();
    state.providers = config.providers || [];
    state.maxChainMessages = Number(config.limits?.maxChainMessages || 8);
    state.kimiEnvAvailable = Boolean(config.kimiPrivate?.envKeyAvailable);
    state.kimiModel = config.kimiPrivate?.model || "kimi-k3";
    state.genEnabled = Boolean(config.genPrivate?.enabled);
    state.genModel = config.genPrivate?.model || "gpt-5.6-sol";
    if (state.kimiKey && !state.kimiEnvAvailable && config.kimiPrivate?.persistsServerKey) {
      state.kimiEnvAvailable = await saveKimiKeyToServer(state.kimiKey);
    }
    const saved = readStoredSelection();
    for (const provider of state.providers) {
      if (provider.available && (saved.size ? saved.has(provider.id) : true)) state.selected.add(provider.id);
    }

    const stateResponse = await apiFetch("/api/state");
    if (!stateResponse.ok) throw new Error("无法读取聊天历史与记忆");
    const serverState = await stateResponse.json();
    if (Array.isArray(serverState.messages) && serverState.messages.length) {
      state.history = serverState.messages;
    } else if (state.history.length) {
      const imported = await apiFetch("/api/messages/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: state.history }),
      });
      if (imported.ok) state.history = (await imported.json()).messages || state.history;
    }
    state.memories = Array.isArray(serverState.memories) ? serverState.memories : [];
    persistHistory();
    renderProviders();
    renderMentionBar();
    setActiveChat(state.activeChat, false);
  } catch (error) {
    appendSystem(error.message);
  }
}

async function sendGroupMessage(text, images = []) {
  if (!state.selected.size) return appendSystem("请先选择至少一位成员");
  const optimistic = userMessage(text, "group", images);
  addMessage(optimistic);
  clearComposer();
  setRunning(true);
  try {
    const response = await apiFetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        text,
        images: serializeImages(images),
        participants: [...state.selected],
        autoRelay: els.relayToggle.checked,
        maxMessages: state.maxChainMessages,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `请求失败 (${response.status})`);
    }
    await consumeNdjson(response.body, handleGroupEvent);
  } catch (error) {
    appendSystem(error.name === "AbortError" ? "连接已停止" : error.message);
  } finally {
    setRunning(false);
  }
}

async function sendKimiMessage(text, images = []) {
  if (!hasKimiKey()) {
    applyPrivateAuthState();
    return;
  }
  state.memorySyncVersion.kimi += 1;
  state.notices = state.notices.filter((notice) => notice.channel !== "kimi");
  const optimistic = userMessage(text, "kimi", images);
  addMessage(optimistic);
  clearComposer();
  setRunning(true);
  state.draft = null;
  try {
    const headers = { "content-type": "application/json" };
    if (state.kimiKey) headers["x-kimi-api-key"] = state.kimiKey;
    const response = await apiFetch("/api/kimi/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: state.sessionId, text, images: serializeImages(images) }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `请求失败 (${response.status})`);
    }
    await consumeNdjson(response.body, (event) => handlePrivateEvent(event, "kimi"));
  } catch (error) {
    appendSystem(error.name === "AbortError" ? "连接已停止" : error.message);
  } finally {
    state.draft = null;
    renderHistory();
    setRunning(false);
  }
}

async function sendGenMessage(text, images = []) {
  if (!state.genEnabled) return appendSystem("Gen 本地通道尚未连接");
  state.memorySyncVersion.gen += 1;
  state.notices = state.notices.filter((notice) => notice.channel !== "gen");
  const optimistic = userMessage(text, "gen", images);
  addMessage(optimistic);
  clearComposer();
  setRunning(true);
  state.draft = null;
  try {
    const response = await apiFetch("/api/gen/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: state.sessionId, text, images: serializeImages(images) }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `请求失败 (${response.status})`);
    }
    await consumeNdjson(response.body, (event) => handlePrivateEvent(event, "gen"));
  } catch (error) {
    appendPrivateNotice("gen", error.name === "AbortError" ? "连接已停止" : `Gen 回复失败：${error.message}`);
  } finally {
    state.draft = null;
    renderHistory();
    setRunning(false);
  }
}

function userMessage(content, channel, images = []) {
  return {
    id: crypto.randomUUID(),
    role: "user",
    author: "用户",
    channel,
    content,
    attachments: images.map((image) => ({
      type: "image",
      name: image.name,
      mimeType: image.type,
      url: image.dataUrl,
    })),
    createdAt: new Date().toISOString(),
    pending: true,
  };
}

async function consumeNdjson(stream, handler) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) if (line.trim()) handler(JSON.parse(line));
    if (done) break;
  }
  if (buffer.trim()) handler(JSON.parse(buffer));
}

function handleGroupEvent(event) {
  if (event.type === "accepted" && event.message) acceptOptimistic(event.message, "group");
  if (event.type === "chat_start") {
    const names = event.initialRecipients.map((provider) => provider.label).join("、");
    els.status.textContent = `${names} 已读`;
  }
  if (event.type === "speaker_start") els.status.textContent = `${event.provider.label} 正在输入…`;
  if (event.type === "message") addMessage({ ...event.message, channel: "group" });
  if (event.type === "speaker_error") appendSystem(`${event.provider.label} 回复失败：${event.message}`);
  if (event.type === "run_error") appendSystem(event.message);
  if (event.type === "chat_done") {
    const labels = { stopped: "已停止", safety_limit: "已自动暂停", idle: "" };
    els.status.textContent = labels[event.reason] || "";
  }
}

function handlePrivateEvent(event, channel) {
  const profile = channel === "gen"
    ? { name: "Gen", providerId: "gen", model: state.genModel }
    : { name: "Kimi", providerId: "kimi", model: state.kimiModel };
  if (event.type === "accepted" && event.message) acceptOptimistic(event.message, channel);
  if (event.type === "read") {
    const message = state.history.find((item) => item.id === event.messageId);
    if (message) message.readAt = event.readAt;
    persistHistory();
    renderHistory();
  }
  if (event.type === "typing") els.status.textContent = `${profile.name} 正在输入…`;
  if (event.type === "thinking_delta" || event.type === "content_delta") {
    ensurePrivateDraft(channel, profile);
    if (event.type === "thinking_delta") state.draft.reasoning += event.delta;
    else state.draft.content += event.delta;
    els.status.textContent = event.type === "thinking_delta" ? `${profile.name} 正在思考…` : `${profile.name} 正在输入…`;
    scheduleDraftRender();
  }
  if (event.type === "tool_start" || event.type === "tool_done") {
    ensurePrivateDraft(channel, profile);
    const existing = state.draft.toolCalls.find((item) => item.name === event.name && item.status === "running");
    const activity = existing || { name: event.name, label: event.label || event.name, status: "running" };
    activity.status = event.type === "tool_done" ? (event.status || "done") : "running";
    if (!existing) state.draft.toolCalls.push(activity);
    els.status.textContent = activity.label?.includes("网页") ? `${profile.name} 正在读取网页…` : `${profile.name} 正在联网搜索…`;
    scheduleDraftRender();
  }
  if (event.type === "message") {
    state.draft = null;
    addMessage(event.message);
  }
  if (event.type === "memory_changed" && event.memory) {
    if (event.action === "deleted") {
      state.memories = state.memories.filter((item) => item.id !== event.memory.id);
    } else {
      const index = state.memories.findIndex((item) => item.id === event.memory.id);
      if (index >= 0) state.memories[index] = event.memory;
      else state.memories.push(event.memory);
    }
    const verbs = { created: "记住了", updated: "更新了记忆", deleted: "忘掉了" };
    state.notices.push({ channel, text: `${profile.name} ${verbs[event.action] || "整理了记忆"}：${event.memory.text}` });
    state.notices = state.notices.slice(-20);
    renderMemories();
    renderHistory();
  }
  if (event.type === "memory_notice") {
    state.notices.push({ channel, text: event.message });
    state.notices = state.notices.slice(-20);
    renderHistory();
  }
  if (event.type === "run_error") {
    state.notices.push({ channel, text: `${profile.name} 回复失败：${event.message}` });
    state.notices = state.notices.slice(-20);
    renderHistory();
  }
  if (event.type === "chat_done") {
    els.status.textContent = event.reason === "stopped" ? "已停止" : "";
    setRunning(false);
    if (channel === "kimi" && event.reason === "complete") scheduleMemorySync("kimi", "Kimi", state.memorySyncVersion.kimi);
  }
}

function ensurePrivateDraft(channel, profile) {
  if (state.draft) return state.draft;
  state.draft = {
    id: `${channel}-draft`,
    role: "assistant",
    providerId: profile.providerId,
    author: profile.name,
    channel,
    model: profile.model,
    content: "",
    reasoning: "",
    toolCalls: [],
    createdAt: new Date().toISOString(),
    pending: true,
  };
  return state.draft;
}

function appendPrivateNotice(channel, text) {
  state.notices.push({ channel, text });
  state.notices = state.notices.slice(-20);
  renderHistory();
}

function scheduleMemorySync(namespace, name, version) {
  for (const delay of [1200, 3500, 8000]) {
    setTimeout(() => syncPrivateMemories(namespace, name, version), delay);
  }
}

async function syncPrivateMemories(namespace, name, version) {
  if (state.memorySyncVersion[namespace] !== version) return;
  const response = await apiFetch(`/api/memories?namespace=${encodeURIComponent(namespace)}&limit=200`).catch(() => null);
  if (!response?.ok || state.memorySyncVersion[namespace] !== version) return;
  const payload = await response.json().catch(() => ({}));
  const fresh = Array.isArray(payload.memories) ? payload.memories : [];
  const previous = state.memories.filter((memory) => memory.namespace === namespace);
  const previousById = new Map(previous.map((memory) => [memory.id, memory]));
  const freshById = new Map(fresh.map((memory) => [memory.id, memory]));
  const changes = [];
  for (const memory of fresh) {
    const old = previousById.get(memory.id);
    if (!old) changes.push(`${name} 记住了：${memory.text}`);
    else if (old.text !== memory.text || old.updatedAt !== memory.updatedAt) changes.push(`${name} 更新了记忆：${memory.text}`);
  }
  for (const memory of previous) {
    if (!freshById.has(memory.id)) changes.push(`${name} 忘掉了：${memory.text}`);
  }
  state.memories = [...state.memories.filter((memory) => memory.namespace !== namespace), ...fresh];
  for (const text of changes) state.notices.push({ channel: namespace === "g" ? "gen" : namespace, text });
  state.notices = state.notices.slice(-20);
  renderMemories();
  renderHistory();
}

function acceptOptimistic(message, channel) {
  const optimistic = [...state.history].reverse().find((item) => (
    item.pending && messageChannel(item) === channel && item.content === message.content
  ));
  if (!optimistic) return;
  Object.assign(optimistic, message, { channel });
  delete optimistic.pending;
  persistHistory();
  renderHistory();
}

function renderProviders() {
  els.providerList.replaceChildren(...state.providers.map((provider) => {
    const label = document.createElement("label");
    label.className = `provider-card${provider.available ? "" : " disabled"}`;
    label.title = provider.available ? provider.model : provider.unavailableReason;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.provider = provider.id;
    input.checked = state.selected.has(provider.id);
    input.disabled = !provider.available;
    const presence = document.createElement("span");
    presence.className = `presence ${provider.available ? "online" : "offline"}`;
    const main = document.createElement("span");
    main.className = "provider-main";
    const strong = document.createElement("strong");
    strong.textContent = provider.label;
    const small = document.createElement("small");
    small.textContent = provider.available ? "在线" : "暂未连接";
    main.append(strong, small);
    label.append(input, presence, main);
    return label;
  }));
}

function renderMentionBar() {
  const selected = state.providers.filter((provider) => provider.available && state.selected.has(provider.id));
  const buttons = [];
  if (selected.length > 1) buttons.push(mentionButton("所有人"));
  for (const provider of selected) buttons.push(mentionButton(provider.label));
  els.mentionBar.replaceChildren(...buttons);
}

function mentionButton(name) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.mention = name;
  button.textContent = `@${name}`;
  return button;
}

function renderMemories() {
  const namespace = memoryNamespace(state.activeChat);
  const memories = state.memories.filter((memory) => memory.namespace === namespace);
  els.memoryTitle.textContent = state.activeChat === "kimi" ? "Kimi 的记忆" : state.activeChat === "gen" ? "Gen 的记忆" : "共享记忆";
  els.memoryInput.placeholder = state.activeChat === "kimi" ? "让 Kimi 记住…" : state.activeChat === "gen" ? "让 Gen 记住…" : "记住一件事";
  els.memoryList.replaceChildren();
  if (!memories.length) {
    const empty = document.createElement("p");
    empty.className = "memory-empty";
    empty.textContent = "暂无记忆";
    els.memoryList.append(empty);
  } else {
    for (const memory of memories) {
      const item = document.createElement("div");
      item.className = "memory-item";
      const text = document.createElement("span");
      text.textContent = memory.text;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.memoryId = memory.id;
      remove.setAttribute("aria-label", `删除记忆：${memory.text.slice(0, 30)}`);
      remove.textContent = "删除";
      item.append(text, remove);
      els.memoryList.append(item);
    }
  }
  els.memoryCount.textContent = String(memories.length);
}

function renderHistory() {
  if (draftRenderFrame) {
    cancelAnimationFrame(draftRenderFrame);
    draftRenderFrame = 0;
  }
  els.messages.replaceChildren();
  const visible = state.history.filter((message) => messageChannel(message) === state.activeChat);
  visible.forEach(renderMessage);
  if (state.draft && messageChannel(state.draft) === state.activeChat) renderMessage(state.draft);
  const notices = state.notices.filter((notice) => notice.channel === state.activeChat);
  for (const notice of notices) {
    const item = document.createElement("div");
    item.className = "system-message";
    item.textContent = notice.text;
    els.messages.append(item);
  }
  const hasContent = visible.length > 0 || Boolean(state.draft) || notices.length > 0;
  els.empty.hidden = hasContent || !els.kimiSetup.hidden || (state.activeChat === "gen" && !state.genEnabled);
  scrollToBottom();
}

function addMessage(message) {
  if (state.history.some((item) => item.id === message.id)) return;
  state.history.push(message);
  if (state.history.length > 300) state.history = state.history.slice(-300);
  persistHistory();
  if (messageChannel(message) === state.activeChat) renderHistory();
}

function renderMessage(message) {
  els.messages.append(createMessageElement(message));
}

function createMessageElement(message) {
  const article = document.createElement("article");
  article.className = `message ${message.role === "user" ? "user" : "assistant"}`;
  article.dataset.provider = message.providerId || "user";
  article.dataset.messageId = message.id || "";
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = message.role === "user" ? "你" : avatarLabel(message);
  const body = document.createElement("div");
  body.className = "message-body";
  if (message.content) {
    body.classList.add("copyable");
    body.dataset.copyText = message.content;
    body.title = "长按复制";
  }
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const name = document.createElement("strong");
  name.textContent = message.role === "user" ? "你" : (message.author || "AI");
  const detail = document.createElement("span");
  const labels = [];
  if (message.triggeredBy) labels.push(`回复 ${message.triggeredBy}`);
  if (message.role === "user" && ["kimi", "gen"].includes(messageChannel(message)) && message.readAt) {
    labels.push("已读");
    detail.classList.add("read-label");
  }
  const time = formatTime(message.createdAt);
  if (time) labels.push(time);
  detail.textContent = labels.join(" · ");
  meta.append(name, detail);
  body.append(meta);

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length) {
    const gallery = document.createElement("div");
    gallery.className = "message-images";
    for (const attachment of attachments) {
      if (attachment?.type !== "image" || !attachment.url) continue;
      const image = document.createElement("img");
      image.src = attachment.url;
      image.alt = attachment.name || "聊天图片";
      image.loading = "lazy";
      image.addEventListener("click", () => window.open(attachment.url, "_blank", "noopener"));
      gallery.append(image);
    }
    if (gallery.childElementCount) body.append(gallery);
  }

  if (Array.isArray(message.toolCalls) && message.toolCalls.length) {
    const tools = document.createElement("div");
    tools.className = "tool-calls";
    tools.dataset.part = "tools";
    for (const call of message.toolCalls) {
      const item = document.createElement("span");
      updateToolElement(item, call);
      tools.append(item);
    }
    body.append(tools);
  }

  if (message.reasoning) {
    const details = document.createElement("details");
    details.className = "thinking-panel";
    details.dataset.part = "thinking";
    details.open = Boolean(message.pending);
    const summary = document.createElement("summary");
    summary.textContent = message.pending ? "正在思考…" : "思考过程";
    const reasoning = document.createElement("div");
    reasoning.className = "thinking-content";
    reasoning.dataset.part = "reasoning";
    reasoning.textContent = message.reasoning;
    details.append(summary, reasoning);
    body.append(details);
  }
  if (message.content) {
    const content = document.createElement("div");
    content.className = "message-content";
    content.dataset.part = "content";
    appendRichText(content, message.content);
    body.append(content);
  }
  article.append(avatar, body);
  return article;
}

let draftRenderFrame = 0;

function scheduleDraftRender() {
  if (draftRenderFrame) return;
  draftRenderFrame = requestAnimationFrame(() => {
    draftRenderFrame = 0;
    updateDraftMessage();
  });
}

function updateDraftMessage() {
  const draft = state.draft;
  if (!draft || messageChannel(draft) !== state.activeChat) return;
  let article = els.messages.querySelector(`[data-message-id="${draft.id}"]`);
  if (!article) {
    renderMessage(draft);
    scrollToBottom(false);
    return;
  }
  const reasoning = article.querySelector('[data-part="reasoning"]');
  const content = article.querySelector('[data-part="content"]');
  const tools = article.querySelector('[data-part="tools"]');
  const needsStructureRefresh = Boolean(draft.reasoning) !== Boolean(reasoning)
    || Boolean(draft.content) !== Boolean(content)
    || (draft.toolCalls?.length || 0) !== (tools?.children.length || 0);
  if (needsStructureRefresh) {
    const replacement = createMessageElement(draft);
    article.replaceWith(replacement);
    article = replacement;
  } else {
    if (reasoning && reasoning.textContent !== draft.reasoning) reasoning.textContent = draft.reasoning;
    if (content && content.textContent !== draft.content) {
      content.textContent = draft.content;
    }
    if (tools) [...tools.children].forEach((item, index) => updateToolElement(item, draft.toolCalls[index]));
  }
  scrollToBottom(false);
}

function updateToolElement(item, call = {}) {
  item.className = `tool-call${call.status === "failed" ? " failed" : ""}`;
  item.dataset.status = call.status || "done";
  item.textContent = `${call.status === "running" ? "◌" : call.status === "failed" ? "!" : "✓"} ${call.label || call.name || "工具"}`;
}

function appendRichText(container, value) {
  const parts = String(value || "").split(/(@[A-Za-z0-9_-]+(?:\s+Code)?|@(?:所有人|全体))/gu);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("@")) {
      const mention = document.createElement("span");
      mention.className = "mention";
      mention.textContent = part;
      container.append(mention);
    } else container.append(document.createTextNode(part));
  }
}

function appendSystem(text) {
  const item = document.createElement("div");
  item.className = "system-message";
  item.textContent = text;
  els.empty.hidden = true;
  els.messages.append(item);
  scrollToBottom();
}

function setActiveChat(chat, shouldClose = true) {
  if (!["group", "kimi", "gen"].includes(chat)) return;
  state.activeChat = chat;
  document.body.dataset.chat = chat;
  localStorage.setItem("roundtable.activeChat", chat);
  els.conversationCards.forEach((card) => card.classList.toggle("active", card.dataset.chat === chat));
  const isKimi = chat === "kimi";
  const isGen = chat === "gen";
  const isPrivate = isKimi || isGen;
  els.groupAvatar.hidden = isPrivate;
  els.privateAvatar.hidden = !isPrivate;
  els.privateAvatar.classList.toggle("kimi-avatar", isKimi);
  els.privateAvatar.classList.toggle("gen-avatar", isGen);
  els.privateAvatar.textContent = isKimi ? "Ki" : isGen ? "G" : "";
  els.relayControl.hidden = isPrivate;
  els.kimiMemory.hidden = false;
  els.kimiSettings.hidden = !isKimi;
  els.membersSection.hidden = isPrivate;
  els.turnBudget.hidden = isPrivate;
  els.mentionBar.hidden = isPrivate;
  els.channelName.textContent = isKimi ? "Kimi" : isGen ? "Gen" : "客厅";
  els.emptyAvatar.className = `empty-avatar${isGen ? " gen-avatar" : isKimi ? " kimi-avatar" : ""}`;
  els.emptyAvatar.textContent = isKimi ? "Ki" : isGen ? "G" : "客";
  els.emptyName.textContent = isKimi ? "Kimi" : isGen ? "Gen" : "客厅";
  els.emptyCopy.textContent = isPrivate ? "开始聊天" : "发条消息吧";
  els.chat.setAttribute("aria-label", isKimi ? "与 Kimi 私聊" : isGen ? "与 Gen 私聊" : "群聊");
  applyPrivateAuthState();
  renderRunningState();
  updateHeader();
  renderMemories();
  renderHistory();
  if (shouldClose) {
    closeSidebar();
    closeMemoryPanel();
  }
}

function applyPrivateAuthState() {
  const kimiLocked = state.activeChat === "kimi" && !hasKimiKey();
  const genLocked = state.activeChat === "gen" && !state.genEnabled;
  const locked = kimiLocked || genLocked;
  els.kimiSetup.hidden = !kimiLocked;
  els.composerWrap.classList.toggle("locked", locked);
  els.input.disabled = locked;
  els.attachButton.disabled = locked || state.running;
  els.imageInput.disabled = locked || state.running;
  els.send.disabled = locked || state.running;
  if (locked) els.empty.hidden = true;
}

function updateHeader() {
  const online = state.providers.filter((provider) => provider.available).length;
  const selected = state.providers.filter((provider) => provider.available && state.selected.has(provider.id));
  els.participantCount.textContent = String(online);
  els.turnBudget.textContent = `最多 ${state.maxChainMessages} 句`;
  els.kimiCardPreview.textContent = hasKimiKey() ? `${state.kimiModel} · 在线` : `${state.kimiModel} · 需要 API Key`;
  els.genCardPreview.textContent = state.genEnabled ? `${state.genModel} · 在线` : "本地通道未连接";
  if (state.activeChat === "kimi") {
    const status = hasKimiKey() ? `${state.kimiModel} · 在线` : `${state.kimiModel} · 需要 API Key`;
    els.channelSubtitle.textContent = status;
  } else if (state.activeChat === "gen") {
    const status = state.genEnabled ? `${state.genModel} · 在线` : "本地通道未连接";
    els.channelSubtitle.textContent = status;
  } else {
    els.channelSubtitle.textContent = selected.length ? `${selected.length} 位成员` : "暂无成员";
  }
}

function setRunning(running) {
  state.running = running;
  if (running) state.runningChannel = state.activeChat;
  else state.runningChannel = "";
  els.send.disabled = running
    || (state.activeChat === "kimi" && !hasKimiKey())
    || (state.activeChat === "gen" && !state.genEnabled);
  els.providerList.querySelectorAll("input").forEach((input) => {
    input.disabled = running || input.closest("label").classList.contains("disabled");
  });
  els.relayToggle.disabled = running;
  els.attachButton.disabled = running
    || (state.activeChat === "kimi" && !hasKimiKey())
    || (state.activeChat === "gen" && !state.genEnabled);
  els.imageInput.disabled = els.attachButton.disabled;
  renderRunningState();
  if (!running) setTimeout(() => { els.status.hidden = true; }, 1600);
}

function renderRunningState() {
  const visible = state.running && state.activeChat === state.runningChannel;
  els.stop.hidden = !visible;
  els.status.hidden = !visible;
}

function insertAtCursor(value) {
  const start = els.input.selectionStart ?? els.input.value.length;
  const end = els.input.selectionEnd ?? start;
  const before = els.input.value.slice(0, start);
  const spacer = value.startsWith("@") && before && !/\s$/.test(before) ? " " : "";
  els.input.value = `${before}${spacer}${value}${els.input.value.slice(end)}`;
  const cursor = before.length + spacer.length + value.length;
  els.input.focus();
  els.input.setSelectionRange(cursor, cursor);
  resizeInput();
}

function resizeInput() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(els.input.scrollHeight, 130)}px`;
}

function clearComposer() {
  els.input.value = "";
  els.input.style.height = "auto";
  els.emojiPanel.hidden = true;
  state.pendingImages = [];
  els.imageInput.value = "";
  renderImagePreview();
}

async function addPendingImages(files) {
  const accepted = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  const available = Math.max(0, 4 - state.pendingImages.length);
  for (const file of files.slice(0, available)) {
    if (!accepted.has(file.type)) {
      appendSystem(`${file.name} 不是支持的图片格式`);
      continue;
    }
    if (file.size > 6_000_000) {
      appendSystem(`${file.name} 超过 6 MB`);
      continue;
    }
    state.pendingImages.push({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type,
      dataUrl: await readFileAsDataUrl(file),
    });
  }
  if (files.length > available) appendSystem("一次最多发送 4 张图片");
  renderImagePreview();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function renderImagePreview() {
  els.imagePreview.replaceChildren();
  for (const pending of state.pendingImages) {
    const item = document.createElement("div");
    item.className = "image-preview-item";
    const image = document.createElement("img");
    image.src = pending.dataUrl;
    image.alt = pending.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.imageId = pending.id;
    remove.setAttribute("aria-label", `移除 ${pending.name}`);
    remove.textContent = "×";
    item.append(image, remove);
    els.imagePreview.append(item);
  }
  els.imagePreview.hidden = !state.pendingImages.length;
}

function serializeImages(images) {
  return images.map(({ name, type, dataUrl }) => ({ name, mimeType: type, dataUrl }));
}

function hasKimiKey() {
  return Boolean(state.kimiKey || state.kimiEnvAvailable);
}

function messageChannel(message) {
  return ["kimi", "gen"].includes(message?.channel) ? message.channel : "group";
}

function memoryNamespace(chat) {
  if (chat === "kimi") return "kimi";
  if (chat === "gen") return "g";
  return "shared";
}

function avatarLabel(message) {
  if (message?.providerId === "gen" || message?.author === "Gen") return "G";
  if (message?.providerId === "kimi" || message?.author === "Kimi") return "Ki";
  if (["anthropic", "claude-code"].includes(message?.providerId) || message?.author === "K") return "K";
  return initials(message?.author || "AI");
}

function openSidebar() {
  els.shell.classList.add("sidebar-open");
  els.sidebarOverlay.hidden = false;
}

function closeSidebar() {
  els.shell.classList.remove("sidebar-open");
  els.sidebarOverlay.hidden = true;
}

function openMemoryPanel() {
  closeSidebar();
  renderMemories();
  els.memoryPanel.hidden = false;
  els.memoryOverlay.hidden = false;
  setTimeout(() => els.memoryInput.focus(), 0);
}

function closeMemoryPanel() {
  els.memoryPanel.hidden = true;
  els.memoryOverlay.hidden = true;
}

function persistHistory() {
  const safeHistory = state.history.map(({ pending, ...message }) => ({
    ...message,
    attachments: (message.attachments || []).filter((attachment) => !String(attachment.url || "").startsWith("data:")),
  }));
  localStorage.setItem("roundtable.history", JSON.stringify(safeHistory));
}

function readStoredHistory() {
  try {
    const value = JSON.parse(localStorage.getItem("roundtable.history") || "[]");
    return Array.isArray(value) ? value.slice(-300) : [];
  } catch { return []; }
}

function readStoredSelection() {
  try {
    const value = JSON.parse(localStorage.getItem("roundtable.selection") || "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch { return new Set(); }
}

function initials(value) {
  return String(value || "AI").replace(/\s+/g, "").slice(0, 2).toUpperCase();
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function scrollToBottom(smooth = true) {
  requestAnimationFrame(() => els.chat.scrollTo({ top: els.chat.scrollHeight, behavior: smooth ? "smooth" : "auto" }));
}

function clearCopyPress() {
  if (copyPressTimer) clearTimeout(copyPressTimer);
  copyPressTimer = null;
  copyPressTarget = null;
  copyPressStart = null;
}

async function copyMessageBubble(target) {
  const text = target?.dataset?.copyText;
  if (!text) return;
  target.classList.add("copying");
  setTimeout(() => target.classList.remove("copying"), 160);
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch { /* use selection fallback */ }
  if (!copied) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    copied = document.execCommand("copy");
    textarea.remove();
  }
  els.copyToast.textContent = copied ? "已复制" : "复制失败";
  els.copyToast.hidden = false;
  clearTimeout(copyMessageBubble.toastTimer);
  copyMessageBubble.toastTimer = setTimeout(() => { els.copyToast.hidden = true; }, 1100);
  navigator.vibrate?.(18);
}

function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = sessionStorage.getItem("roundtable.accessToken");
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

async function saveKimiKeyToServer(apiKey) {
  const response = await apiFetch("/api/kimi/key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (response.ok) return true;
  const payload = await response.json().catch(() => ({}));
  appendSystem(payload.error || "Kimi API Key 保存失败");
  return false;
}
