import { createMemberProfile } from "./member-profile.js?v=20260722-1";

const els = {
  shell: document.querySelector("#app-shell"),
  mainPanel: document.querySelector(".main-panel"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarClose: document.querySelector("#sidebar-close"),
  sidebarOverlay: document.querySelector("#sidebar-overlay"),
  memoryOverlay: document.querySelector("#memory-overlay"),
  memoryPanel: document.querySelector("#memory-panel"),
  memoryClose: document.querySelector("#memory-close"),
  avatarSettings: document.querySelector("#avatar-settings-button"),
  avatarOverlay: document.querySelector("#avatar-overlay"),
  avatarPanel: document.querySelector("#avatar-panel"),
  avatarClose: document.querySelector("#avatar-close"),
  avatarImageInput: document.querySelector("#avatar-image-input"),
  avatarEditorList: document.querySelector(".avatar-editor-list"),
  avatarStatus: document.querySelector("#avatar-status"),
  avatarCropDialog: document.querySelector("#avatar-crop-dialog"),
  avatarCropCanvas: document.querySelector("#avatar-crop-canvas"),
  avatarCropZoom: document.querySelector("#avatar-crop-zoom"),
  avatarCropClose: document.querySelector("#avatar-crop-close"),
  avatarCropCancel: document.querySelector("#avatar-crop-cancel"),
  avatarCropConfirm: document.querySelector("#avatar-crop-confirm"),
  historySearchOverlay: document.querySelector("#history-search-overlay"),
  historySearchPanel: document.querySelector("#history-search-panel"),
  historySearchClose: document.querySelector("#history-search-close"),
  historySearchForm: document.querySelector("#history-search-form"),
  historySearchChannel: document.querySelector("#history-search-channel"),
  historySearchInput: document.querySelector("#history-search-input"),
  historySearchCount: document.querySelector("#history-search-count"),
  historySearchMembers: document.querySelector("#history-search-members"),
  historySearchResults: document.querySelector("#history-search-results"),
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
  chatInfoButton: document.querySelector("#chat-info-button"),
  chatInfoOverlay: document.querySelector("#chat-info-overlay"),
  chatInfoPanel: document.querySelector("#chat-info-panel"),
  chatInfoClose: document.querySelector("#chat-info-close"),
  chatInfoTitle: document.querySelector("#chat-info-title"),
  chatInfoMembersSection: document.querySelector("#chat-info-members-section"),
  chatInfoMembers: document.querySelector("#chat-info-members"),
  chatInfoMemberCount: document.querySelector("#chat-info-member-count"),
  chatInfoNameSection: document.querySelector("#chat-info-name-section"),
  chatInfoNameLabel: document.querySelector("#chat-info-name-label"),
  chatInfoName: document.querySelector("#chat-info-name"),
  chatInfoMemory: document.querySelector("#chat-info-memory"),
  chatInfoMemoryCount: document.querySelector("#chat-info-memory-count"),
  chatInfoSearch: document.querySelector("#chat-info-search"),
  chatInfoBackground: document.querySelector("#chat-info-background"),
  chatInfoBackgroundReset: document.querySelector("#chat-info-background-reset"),
  chatInfoBackgroundPreview: document.querySelector("#chat-info-background-preview"),
  chatBackgroundInput: document.querySelector("#chat-background-input"),
  chatBackgroundStatus: document.querySelector("#chat-background-status"),
  kimiSettings: document.querySelector("#kimi-settings-button"),
  kimiCardPreview: document.querySelector("#kimi-card-preview"),
  glmCardPreview: document.querySelector("#glm-card-preview"),
  genCardPreview: document.querySelector("#gen-card-preview"),
  groupCardPreview: document.querySelector("#group-card-preview"),
  unreadDots: [...document.querySelectorAll("[data-unread]")],
  genWorkbar: document.querySelector("#gen-workbar"),
  genModeButtons: [...document.querySelectorAll("[data-gen-mode]")],
  genWorkspaceWrap: document.querySelector("#gen-workspace-wrap"),
  genWorkspace: document.querySelector("#gen-workspace"),
  kimiSetup: document.querySelector("#kimi-setup"),
  kimiKeyInput: document.querySelector("#kimi-api-key"),
  glmSetup: document.querySelector("#glm-setup"),
  glmKeyInput: document.querySelector("#glm-api-key"),
  chat: document.querySelector("#chat"),
  empty: document.querySelector("#empty-state"),
  emptyAvatar: document.querySelector("#empty-avatar"),
  emptyName: document.querySelector("#empty-name"),
  emptyCopy: document.querySelector("#empty-copy"),
  messages: document.querySelector("#messages"),
  loadEarlier: document.querySelector("#load-earlier-messages"),
  composerWrap: document.querySelector("#composer-wrap"),
  composer: document.querySelector("#composer"),
  input: document.querySelector("#message-input"),
  imageInput: document.querySelector("#image-input"),
  imagePreview: document.querySelector("#image-preview"),
  quotePreview: document.querySelector("#quote-preview"),
  quotePreviewAuthor: document.querySelector("#quote-preview-author"),
  quotePreviewText: document.querySelector("#quote-preview-text"),
  quotePreviewClose: document.querySelector("#quote-preview-close"),
  attachButton: document.querySelector("#attach-button"),
  send: document.querySelector("#send-button"),
  stop: document.querySelector("#stop-button"),
  status: document.querySelector("#run-status"),
  clear: document.querySelector("#clear-button"),
  memoryTitle: document.querySelector("#memory-title"),
  memoryForm: document.querySelector("#memory-form"),
  memoryInput: document.querySelector("#memory-input"),
  memoryList: document.querySelector("#memory-list"),
  memoryCount: document.querySelector("#memory-count"),
  copyToast: document.querySelector("#copy-toast"),
  imageLightbox: document.querySelector("#image-lightbox"),
  imageLightboxImage: document.querySelector("#image-lightbox-image"),
  imageLightboxClose: document.querySelector("#image-lightbox-close"),
  messageActionOverlay: document.querySelector("#message-action-overlay"),
  messageActionMenu: document.querySelector("#message-action-menu"),
  messageActionQuote: document.querySelector("#message-action-quote"),
  messageActionCopy: document.querySelector("#message-action-copy"),
  messageActionDelete: document.querySelector("#message-action-delete"),
};

const initialUrl = new URL(location.href);
const tokenFromUrl = initialUrl.searchParams.get("token");
const requestedChatFromUrl = ["gen", "kimi", "glm"].includes(initialUrl.searchParams.get("chat"))
  ? initialUrl.searchParams.get("chat")
  : "";
if (tokenFromUrl) {
  sessionStorage.setItem("roundtable.accessToken", tokenFromUrl);
}
initialUrl.searchParams.delete("token");
initialUrl.searchParams.delete("chat");
history.replaceState(null, "", `${initialUrl.pathname}${initialUrl.search}${initialUrl.hash}`);

history.replaceState({ ...(history.state || {}), livingRoomSection: "chat", livingRoomView: "home" }, "", location.href);

const cachedUiState = readCachedUiState();
const state = {
  sessionId: localStorage.getItem("roundtable.sessionId") || crypto.randomUUID(),
  history: readStoredHistory(),
  providers: [],
  memories: [],
  avatars: cachedUiState.avatars,
  signatures: cachedUiState.signatures,
  chatBackgrounds: cachedUiState.chatBackgrounds,
  avatarTarget: "",
  notices: [],
  selected: new Set(),
  activeChat: requestedChatFromUrl || (["group", "kimi", "gen", "glm"].includes(localStorage.getItem("roundtable.activeChat"))
    ? localStorage.getItem("roundtable.activeChat")
    : "group"),
  runningChannels: new Set(),
  runStatus: { group: "", kimi: "", gen: "", glm: "" },
  interjecting: false,
  groupThinking: new Set(),
  drafts: { kimi: null, gen: null, glm: null },
  maxChainMessages: 20,
  maxRepliesPerMember: 5,
  kimiKey: sessionStorage.getItem("kimi.apiKey") || "",
  kimiEnvAvailable: false,
  kimiModel: "kimi-k2.5",
  glmKey: sessionStorage.getItem("glm.apiKey") || "",
  glmEnvAvailable: false,
  glmEnabled: true,
  glmModel: "glm-5.1",
  glmVisionModel: "glm-5v-turbo",
  genEnabled: false,
  genModel: "gpt-5.6-sol",
  genWorkEnabled: false,
  genWorkspaces: [],
  genMode: "chat",
  genWorkspaceId: localStorage.getItem("roundtable.genWorkspace") || "living-room",
  genRunContext: null,
  memorySyncVersion: { kimi: 0, gen: 0, glm: 0, group: 0 },
  pendingImages: [],
  composerDrafts: readComposerDrafts(),
  composerImages: { group: [], gen: [], kimi: [], glm: [] },
  composerQuotes: { group: null, gen: null, kimi: null, glm: null },
  hiddenMessageIds: readHiddenMessageIds(),
  historyExhausted: new Set(),
  historySearchMember: "",
  searchReturnToInfo: false,
  seenAt: readSeenAt(),
  hasSeenState: localStorage.getItem("roundtable.seenAt") !== null,
};
localStorage.setItem("roundtable.sessionId", state.sessionId);

const AVATAR_CROP_SIZE = 640;
let avatarCropSession = null;

const memberProfile = createMemberProfile({
  getAvatarUrl: (id) => state.avatars[id] || "",
  getSignature: (id) => state.signatures[id] || "",
  canMessage: (id) => ["gen", "kimi", "glm"].includes(id),
  onMessage: (id) => setActiveChat(id),
  onSaveSignature: saveProfileSignature,
  onUploadAvatar: uploadAvatar,
  onResetAvatar: resetAvatar,
});

els.sidebarToggle.addEventListener("click", returnToChatHome);
els.sidebarClose.addEventListener("click", closeSidebar);
els.sidebarOverlay.addEventListener("click", closeSidebar);
document.querySelector('.bottom-nav-item.active')?.addEventListener("click", (event) => event.preventDefault());
document.querySelector('.bottom-nav-item:not(.active)')?.addEventListener("click", replaceSectionFromBottomNav);
window.addEventListener("popstate", handleChatPopState);
installChatEdgeSwipe();
els.memoryClose.addEventListener("click", closeMemoryPanel);
els.memoryOverlay.addEventListener("click", closeMemoryPanel);
els.avatarSettings?.addEventListener("click", openAvatarPanel);
els.avatarClose?.addEventListener("click", closeAvatarPanel);
els.avatarOverlay?.addEventListener("click", closeAvatarPanel);
els.historySearchClose?.addEventListener("click", () => closeHistorySearch());
els.historySearchOverlay?.addEventListener("click", () => closeHistorySearch());
els.historySearchForm?.addEventListener("submit", searchHistory);
els.historySearchMembers?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-member]");
  if (!button) return;
  state.historySearchMember = state.historySearchMember === button.dataset.member ? "" : button.dataset.member;
  renderHistoryMemberFilters();
  void searchHistory();
});
els.loadEarlier?.addEventListener("click", loadEarlierMessages);
els.imageLightboxClose?.addEventListener("click", closeImageLightbox);
els.imageLightbox?.addEventListener("click", (event) => {
  if (event.target === els.imageLightbox) closeImageLightbox();
});
els.chatInfoButton?.addEventListener("click", openChatInfo);
els.chatInfoClose?.addEventListener("click", closeChatInfo);
els.chatInfoOverlay?.addEventListener("click", closeChatInfo);
els.chatInfoMemory?.addEventListener("click", openMemoryPanel);
els.chatInfoSearch?.addEventListener("click", openHistorySearch);
els.chatInfoBackground?.addEventListener("click", () => els.chatBackgroundInput?.click());
els.chatInfoBackgroundReset?.addEventListener("click", resetChatBackground);
els.chatBackgroundInput?.addEventListener("change", () => void updateChatBackground([...els.chatBackgroundInput.files][0]));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (els.historySearchPanel && !els.historySearchPanel.hidden) {
      closeHistorySearch();
      return;
    }
    if (els.chatInfoPanel && !els.chatInfoPanel.hidden) {
      closeChatInfo();
      return;
    }
    if (!els.imageLightbox?.hidden) {
      closeImageLightbox();
      return;
    }
    if (avatarCropSession) {
      finishAvatarCrop(false);
      return;
    }
    closeSidebar();
    closeMemoryPanel();
    closeAvatarPanel();
  }
});

function openImageLightbox(url, alt = "图片预览") {
  if (!els.imageLightbox || !els.imageLightboxImage) return;
  els.imageLightboxImage.src = url;
  els.imageLightboxImage.alt = alt;
  els.imageLightbox.hidden = false;
  els.imageLightboxClose?.focus();
}

function closeImageLightbox() {
  if (!els.imageLightbox || els.imageLightbox.hidden) return;
  els.imageLightbox.hidden = true;
  if (els.imageLightboxImage) {
    els.imageLightboxImage.removeAttribute("src");
    els.imageLightboxImage.alt = "";
  }
}

els.avatarEditorList?.addEventListener("click", async (event) => {
  const upload = event.target.closest("button[data-avatar-upload]");
  if (upload) {
    state.avatarTarget = upload.dataset.avatarUpload;
    if (!els.avatarImageInput) return;
    els.avatarImageInput.value = "";
    els.avatarImageInput.click();
    return;
  }
  const reset = event.target.closest("button[data-avatar-reset]");
  if (reset) await resetAvatar(reset.dataset.avatarReset);
});

els.avatarImageInput?.addEventListener("change", async () => {
  const [file] = els.avatarImageInput.files || [];
  const target = state.avatarTarget;
  els.avatarImageInput.value = "";
  if (!file || !target) return;
  try {
    const image = await prepareAvatarImage(file);
    if (image) await uploadAvatar(target, image);
  } catch (error) {
    els.avatarStatus.textContent = error.message || "无法处理这张图片";
  }
});

els.avatarCropClose?.addEventListener("click", () => finishAvatarCrop(false));
els.avatarCropCancel?.addEventListener("click", () => finishAvatarCrop(false));
els.avatarCropConfirm?.addEventListener("click", () => finishAvatarCrop(true));
els.avatarCropZoom?.addEventListener("input", () => {
  if (!avatarCropSession) return;
  avatarCropSession.zoom = Number(els.avatarCropZoom.value) || 1;
  clampAvatarCrop();
  renderAvatarCrop();
});
els.avatarCropCanvas?.addEventListener("pointerdown", beginAvatarCropDrag);
els.avatarCropCanvas?.addEventListener("pointermove", moveAvatarCropDrag);
els.avatarCropCanvas?.addEventListener("pointerup", endAvatarCropDrag);
els.avatarCropCanvas?.addEventListener("pointercancel", endAvatarCropDrag);
els.avatarCropCanvas?.addEventListener("wheel", (event) => {
  if (!avatarCropSession) return;
  event.preventDefault();
  avatarCropSession.zoom = Math.max(0.05, Math.min(4, avatarCropSession.zoom + (event.deltaY < 0 ? 0.08 : -0.08)));
  els.avatarCropZoom.value = String(avatarCropSession.zoom);
  clampAvatarCrop();
  renderAvatarCrop();
}, { passive: false });

els.conversations.addEventListener("click", (event) => {
  const card = event.target.closest("[data-chat]");
  if (card) setActiveChat(card.dataset.chat);
});

els.genWorkbar?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-gen-mode]");
  if (!button || isRunning("gen")) return;
  const mode = button.dataset.genMode === "work" ? "work" : "chat";
  if (mode === "work" && !state.genWorkEnabled) return appendPrivateNotice("gen", "Gen 干活模式尚未启用");
  if (mode === "work" && sessionStorage.getItem("roundtable.genWorkConfirmed") !== "true") {
    const workspace = selectedGenWorkspace();
    if (!confirm(`切换到干活模式后，Gen 可以修改“${workspace?.label || "所选工作区"}”里的文件并运行命令。继续吗？`)) return;
    sessionStorage.setItem("roundtable.genWorkConfirmed", "true");
  }
  state.genMode = mode;
  renderGenWorkbar();
  updateHeader();
  els.input.focus();
});

els.genWorkspace?.addEventListener("change", () => {
  if (isRunning("gen")) return;
  state.genWorkspaceId = els.genWorkspace.value;
  localStorage.setItem("roundtable.genWorkspace", state.genWorkspaceId);
  updateHeader();
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

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.interjecting) return;
  const runningHere = isRunning(state.activeChat);
  const canInterject = runningHere && state.activeChat === "group";
  const canGuide = runningHere && state.activeChat === "gen" && state.genRunContext?.mode === "work";
  if (runningHere && !canInterject && !canGuide) return;
  const text = els.input.value.trim();
  const images = state.pendingImages.map(({ name, type, dataUrl }) => ({ name, type, dataUrl }));
  if (!text && !images.length) return;
  if (canGuide) await sendGenGuidance(text, images);
  else if (canInterject) await interjectGroupMessage(text, images);
  else if (state.activeChat === "kimi") await sendKimiMessage(text, images);
  else if (state.activeChat === "glm") await sendGlmMessage(text, images);
  else if (state.activeChat === "gen") await sendGenMessage(text, images);
  else await sendGroupMessage(text, images);
});

els.stop.addEventListener("click", async () => {
  els.stop.disabled = true;
  setChannelStatus(state.activeChat, "正在停止…");
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
  if (isRunning(state.activeChat)) return;
  const labels = { kimi: "与 Kimi 的私聊", glm: "与 Shin 的私聊", gen: "与 Gen 的私聊", group: "客厅聊天" };
  const label = labels[state.activeChat];
  if (!confirm(`清空${label}？长期记忆不会被删除。`)) return;
  const response = await apiFetch(`/api/messages?channel=${encodeURIComponent(state.activeChat)}`, { method: "DELETE" });
  if (!response.ok) return appendSystem("聊天记录清理失败");
  state.history = state.history.filter((message) => messageChannel(message) !== state.activeChat);
  state.notices = state.notices.filter((notice) => notice.channel !== state.activeChat);
  persistHistory();
  renderConversationList();
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
      source: state.activeChat === "kimi" ? "kimi-private-ui" : state.activeChat === "glm" ? "glm-private-ui" : state.activeChat === "gen" ? "gen-private-ui" : "group-chat-ui",
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
  const owner = state.activeChat === "kimi" ? "Kimi" : state.activeChat === "glm" ? "Shin" : state.activeChat === "gen" ? "Gen" : "共享";
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

els.glmSetup?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = els.glmKeyInput?.value.trim() || "";
  if (!apiKey) return;
  const saved = await saveGlmKeyToServer(apiKey);
  if (!saved) return;
  state.glmKey = apiKey;
  state.glmEnvAvailable = true;
  sessionStorage.setItem("glm.apiKey", apiKey);
  if (els.glmKeyInput) els.glmKeyInput.value = "";
  applyPrivateAuthState();
  updateHeader();
  renderHistory();
  els.input.focus();
});

els.kimiSettings.addEventListener("click", () => {
  closeChatInfo();
  const isGlm = state.activeChat === "glm";
  els.kimiSetup.hidden = isGlm;
  if (els.glmSetup) els.glmSetup.hidden = !isGlm;
  els.empty.hidden = true;
  (isGlm ? els.glmKeyInput : els.kimiKeyInput)?.focus();
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
  state.composerImages[state.activeChat] = state.pendingImages;
  renderImagePreview();
});
els.quotePreviewClose?.addEventListener("click", () => clearActiveQuote());
els.messageActionOverlay?.addEventListener("click", closeMessageActions);
els.messageActionCopy?.addEventListener("click", async () => {
  const target = messageActionTarget;
  closeMessageActions();
  if (target) await copyMessageBubble(target);
});
els.messageActionQuote?.addEventListener("click", () => {
  const message = messageActionMessage;
  closeMessageActions();
  if (message) selectMessageQuote(message);
});
els.messageActionDelete?.addEventListener("click", () => {
  const message = messageActionMessage;
  closeMessageActions();
  if (message) hideMessageLocally(message);
});

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    els.composer.requestSubmit();
  }
});

els.input.addEventListener("input", () => {
  resizeInput();
  saveActiveComposerDraft();
});

const composerKeyboard = {
  inset: 0,
  followLatest: false,
  baselineHeight: 0,
  timer: 0,
};

function applyLocalizedKeyboardInset() {
  if (document.activeElement !== els.input || !isActiveChatVisible() || !window.visualViewport) {
    clearLocalizedKeyboardInset();
    return;
  }
  const viewport = window.visualViewport;
  const visibleBottom = viewport.offsetTop + viewport.height;
  const composerBottom = els.composerWrap.getBoundingClientRect().bottom;
  const unadjustedBottom = composerBottom + composerKeyboard.inset;
  const maxInset = Math.round(Math.max(composerKeyboard.baselineHeight, window.innerHeight, document.documentElement.clientHeight) * 0.68);
  const measuredInset = Math.ceil(unadjustedBottom - visibleBottom);
  const nextInset = measuredInset >= 96 && measuredInset <= maxInset ? measuredInset : 0;
  if (Math.abs(nextInset - composerKeyboard.inset) < 2) return;
  composerKeyboard.inset = nextInset;
  els.mainPanel.style.setProperty("--keyboard-inset", `${nextInset}px`);
  if (composerKeyboard.followLatest) {
    requestAnimationFrame(() => {
      els.chat.scrollTop = els.chat.scrollHeight;
    });
  }
}

function scheduleLocalizedKeyboardInset(delay = 120) {
  clearTimeout(composerKeyboard.timer);
  composerKeyboard.timer = setTimeout(applyLocalizedKeyboardInset, delay);
}

function clearLocalizedKeyboardInset() {
  clearTimeout(composerKeyboard.timer);
  composerKeyboard.timer = 0;
  if (!composerKeyboard.inset) return;
  composerKeyboard.inset = 0;
  els.mainPanel.style.removeProperty("--keyboard-inset");
  if (composerKeyboard.followLatest && isActiveChatVisible()) {
    requestAnimationFrame(() => {
      els.chat.scrollTop = els.chat.scrollHeight;
    });
  }
}

function installLocalizedKeyboardInset() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  els.input.addEventListener("focus", () => {
    composerKeyboard.followLatest = isNearBottom(160);
    composerKeyboard.baselineHeight = Math.max(window.innerHeight, document.documentElement.clientHeight, viewport.height);
    scheduleLocalizedKeyboardInset(180);
  });
  els.input.addEventListener("blur", () => {
    clearLocalizedKeyboardInset();
    composerKeyboard.followLatest = false;
  });
  viewport.addEventListener("resize", () => scheduleLocalizedKeyboardInset());
  viewport.addEventListener("scroll", () => scheduleLocalizedKeyboardInset());
  window.addEventListener("orientationchange", clearLocalizedKeyboardInset);
}

let copyPressTimer = null;
let copyPressTarget = null;
let copyPressStart = null;
let messageActionTarget = null;
let messageActionMessage = null;
let messageActionPositionFrame = 0;
els.messages.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button, a, input, summary")) return;
  const target = event.target.closest(".message-body.copyable");
  if (!target || (event.pointerType === "mouse" && event.button !== 0)) return;
  clearCopyPress();
  copyPressTarget = target;
  copyPressStart = { x: event.clientX, y: event.clientY };
  copyPressTimer = setTimeout(() => openMessageActions(target), 520);
});
els.messages.addEventListener("pointermove", (event) => {
  if (!copyPressStart) return;
  if (Math.hypot(event.clientX - copyPressStart.x, event.clientY - copyPressStart.y) > 10) clearCopyPress();
});
els.messages.addEventListener("selectstart", (event) => {
  if (event.target.closest(".message-body.copyable")) event.preventDefault();
});
for (const type of ["pointerup", "pointercancel", "pointerleave"]) els.messages.addEventListener(type, clearCopyPress);
els.messages.addEventListener("contextmenu", (event) => {
  const target = event.target.closest(".message-body.copyable");
  if (!target) return;
  event.preventDefault();
  clearCopyPress();
  openMessageActions(target);
});

async function initialize() {
  try {
    let [response, stateResponse] = await Promise.all([
      apiFetch("/api/config"),
      apiFetch("/api/state"),
    ]);
    if (response.status === 401 || stateResponse.status === 401) {
      const token = prompt("请输入群聊访问口令：")?.trim();
      if (!token) throw new Error("需要访问口令才能连接聊天。");
      sessionStorage.setItem("roundtable.accessToken", token);
      [response, stateResponse] = await Promise.all([
        apiFetch("/api/config"),
        apiFetch("/api/state"),
      ]);
    }
    if (!response.ok) throw new Error("无法读取聊天配置");
    if (!stateResponse.ok) throw new Error("无法读取聊天历史与记忆");
    const [config, serverState] = await Promise.all([response.json(), stateResponse.json()]);
    state.providers = config.providers || [];
    state.maxChainMessages = Number(config.limits?.maxChainMessages || 20);
    state.maxRepliesPerMember = Number(config.limits?.maxRepliesPerMember || 5);
    state.kimiEnvAvailable = Boolean(config.kimiPrivate?.envKeyAvailable);
    state.kimiModel = config.kimiPrivate?.model || "kimi-k2.5";
    state.glmEnabled = config.glmPrivate?.enabled !== false;
    state.glmEnvAvailable = Boolean(config.glmPrivate?.envKeyAvailable);
    state.glmModel = config.glmPrivate?.model || "glm-5.1";
    state.glmVisionModel = config.glmPrivate?.visionModel || "glm-5v-turbo";
    state.genEnabled = Boolean(config.genPrivate?.enabled);
    state.genModel = config.genPrivate?.model || "gpt-5.6-sol";
    state.genWorkEnabled = Boolean(config.genPrivate?.workEnabled);
    state.genWorkspaces = Array.isArray(config.genPrivate?.workspaces) ? config.genPrivate.workspaces : [];
    if (!state.genWorkspaces.some((workspace) => workspace.id === state.genWorkspaceId)) {
      state.genWorkspaceId = state.genWorkspaces[0]?.id || "";
    }
    renderGenWorkbar();
    if (state.kimiKey && !state.kimiEnvAvailable && config.kimiPrivate?.persistsServerKey) {
      state.kimiEnvAvailable = await saveKimiKeyToServer(state.kimiKey);
    }
    if (state.glmKey && !state.glmEnvAvailable && config.glmPrivate?.persistsServerKey) {
      state.glmEnvAvailable = await saveGlmKeyToServer(state.glmKey);
    }
    const saved = readStoredSelection();
    const shouldWelcomeGlm = localStorage.getItem("roundtable.glmJoined") !== "true";
    for (const provider of state.providers) {
      if (provider.available && ((saved.size ? saved.has(provider.id) : true) || (provider.id === "glm" && shouldWelcomeGlm))) {
        state.selected.add(provider.id);
      }
    }
    if (state.providers.some((provider) => provider.id === "glm" && provider.available)) {
      localStorage.setItem("roundtable.glmJoined", "true");
      localStorage.setItem("roundtable.selection", JSON.stringify([...state.selected]));
    }

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
    state.avatars = serverState.avatars && typeof serverState.avatars === "object" ? serverState.avatars : {};
    state.signatures = serverState.signatures && typeof serverState.signatures === "object" ? serverState.signatures : {};
    state.chatBackgrounds = serverState.chatBackgrounds && typeof serverState.chatBackgrounds === "object" ? serverState.chatBackgrounds : {};
    persistUiState();
    initializeSeenState();
    persistHistory();
    renderProviders();
    renderMentionBar();
    setActiveChat(state.activeChat, Boolean(requestedChatFromUrl));
    void resumePendingGroupReply();
    void resumePendingKimiReply();
    void resumePendingGlmReply();
    void resumePendingGenReply();
  } catch (error) {
    appendSystem(error.message);
  }
}

async function refreshUiState() {
  const response = await apiFetch("/api/ui-state").catch(() => null);
  if (!response?.ok) return;
  const payload = await response.json().catch(() => ({}));
  state.avatars = payload.avatars && typeof payload.avatars === "object" ? payload.avatars : state.avatars;
  state.signatures = payload.signatures && typeof payload.signatures === "object" ? payload.signatures : state.signatures;
  state.chatBackgrounds = payload.chatBackgrounds && typeof payload.chatBackgrounds === "object" ? payload.chatBackgrounds : state.chatBackgrounds;
  persistUiState();
  renderAvatars();
  applyChatBackground();
}

function hydrateCachedHistory() {
  if (!state.history.length) return;
  initializeSeenState();
  const chat = state.activeChat;
  const isKimi = chat === "kimi";
  const isGen = chat === "gen";
  const isGlm = chat === "glm";
  const isPrivate = isKimi || isGen || isGlm;
  document.body.dataset.chat = chat;
  els.conversationCards.forEach((card) => card.classList.toggle("active", card.dataset.chat === chat));
  els.groupAvatar.hidden = isPrivate;
  els.privateAvatar.hidden = !isPrivate;
  els.relayControl.hidden = isPrivate;
  els.membersSection.hidden = isPrivate;
  els.turnBudget.hidden = isPrivate;
  els.mentionBar.hidden = isPrivate;
  els.channelName.textContent = isKimi ? "Kimi" : isGlm ? "Shin" : isGen ? "Gen" : "客厅";
  els.chat.setAttribute("aria-label", isKimi ? "与 Kimi 私聊" : isGlm ? "与 Shin 私聊" : isGen ? "与 Gen 私聊" : "群聊");
  applyChatBackground();
  renderConversationList();
  renderHistory({ forceBottom: true });
}

async function syncServerMessages() {
  const latest = state.history.reduce((value, message) => String(message.createdAt || "") > value ? String(message.createdAt) : value, "");
  const syncUrl = latest ? `/api/sync?since=${encodeURIComponent(latest)}` : "/api/sync";
  const response = await apiFetch(syncUrl).catch(() => null);
  if (!response?.ok) return;
  const payload = await response.json().catch(() => ({}));
  const incoming = Array.isArray(payload.messages) ? payload.messages : [];
  const nextAvatars = payload.avatars && typeof payload.avatars === "object" ? payload.avatars : {};
  let uiChanged = false;
  if (JSON.stringify(nextAvatars) !== JSON.stringify(state.avatars)) {
    state.avatars = nextAvatars;
    renderAvatars();
    uiChanged = true;
  }
  const nextSignatures = payload.signatures && typeof payload.signatures === "object" ? payload.signatures : {};
  if (JSON.stringify(nextSignatures) !== JSON.stringify(state.signatures)) {
    state.signatures = nextSignatures;
    memberProfile.refresh();
    uiChanged = true;
  }
  const nextBackgrounds = payload.chatBackgrounds && typeof payload.chatBackgrounds === "object" ? payload.chatBackgrounds : {};
  if (JSON.stringify(nextBackgrounds) !== JSON.stringify(state.chatBackgrounds)) {
    state.chatBackgrounds = nextBackgrounds;
    applyChatBackground();
    if (els.chatInfoPanel && !els.chatInfoPanel.hidden) renderChatInfo();
    uiChanged = true;
  }
  if (uiChanged) persistUiState();
  if (!incoming.length) return;
  const known = new Map(state.history.map((message) => [message.id, message]));
  let changed = false;
  for (const message of incoming) {
    const existing = known.get(message.id);
    if (existing) {
      if (existing.pending) {
        Object.assign(existing, message, { pending: false });
        changed = true;
      }
      continue;
    }
    const optimistic = message.role === "user" ? findMatchingOptimistic(message) : null;
    if (optimistic) {
      Object.assign(optimistic, message, { pending: false });
      known.set(message.id, optimistic);
    } else {
      state.history.push(message);
      known.set(message.id, message);
    }
    changed = true;
  }
  if (!changed) return;
  state.history.sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  persistHistory();
  if (isActiveChatVisible()) markChatRead(state.activeChat, false);
  renderConversationList();
  renderHistory();
}

function findMatchingOptimistic(message) {
  const createdAt = Date.parse(message.createdAt || "");
  return state.history.find((candidate) => {
    if (!candidate.pending || candidate.role !== "user") return false;
    if (messageChannel(candidate) !== messageChannel(message) || candidate.content !== message.content) return false;
    const candidateAt = Date.parse(candidate.createdAt || "");
    return !Number.isFinite(createdAt) || !Number.isFinite(candidateAt) || Math.abs(createdAt - candidateAt) < 120_000;
  }) || null;
}

function startServerMessageSync() {
  const timer = setInterval(() => void syncServerMessages(), 15_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (isActiveChatVisible()) markChatRead(state.activeChat);
      void syncServerMessages();
      void resumePendingGroupReply();
      void resumePendingKimiReply();
      void resumePendingGlmReply();
      void resumePendingGenReply();
    }
  });
window.addEventListener("focus", () => {
  void syncServerMessages();
  void resumePendingGroupReply();
  void resumePendingKimiReply();
  void resumePendingGlmReply();
  void resumePendingGenReply();
});
  return timer;
}

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  state.runningChannels.clear();
  state.interjecting = false;
  state.groupThinking.clear();
  for (const channel of Object.keys(state.runStatus)) state.runStatus[channel] = "";
  applyPrivateAuthState();
  renderRunningState();
  void syncServerMessages();
  void resumePendingGroupReply();
  void resumePendingKimiReply();
  void resumePendingGlmReply();
  void resumePendingGenReply();
});

async function sendGroupMessage(text, images = []) {
  if (!state.selected.size) return appendSystem("请先选择至少一位成员");
  state.memorySyncVersion.group += 1;
  state.notices = state.notices.filter((notice) => notice.channel !== "group");
  const quote = state.composerQuotes.group;
  const optimistic = userMessage(text, "group", images, { quote });
  addMessage(optimistic, { forceBottom: true });
  clearComposer();
  setRunning(true, "group");
  await paintPendingUi();
  let streamOpened = false;
  try {
    const response = await apiFetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        messageId: optimistic.id,
        text,
        quote,
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
    streamOpened = true;
    await consumeNdjson(response.body, handleGroupEvent);
  } catch (error) {
    if (streamOpened || isTransientConnectionError(error)) {
      const recovered = await recoverGroupResult(optimistic.id);
      if (!recovered) appendSystem("这条消息没有送达服务器，请重新发送一次。");
    } else {
      appendSystem(error.name === "AbortError" ? "连接已停止" : error.message);
    }
  } finally {
    setRunning(false, "group");
  }
}

async function interjectGroupMessage(text, images = []) {
  state.interjecting = true;
  applyPrivateAuthState();
  setChannelStatus("group", "正在插话…");
  try {
    const response = await apiFetch("/api/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: state.sessionId, channel: "group" }),
    });
    if (!response.ok) throw new Error("暂时无法停止上一轮接话");
    const stopped = await waitForGroupRunToStop();
    if (!stopped) throw new Error("上一轮还没有停下来，请再试一次");
    state.interjecting = false;
    applyPrivateAuthState();
    await sendGroupMessage(text, images);
  } catch (error) {
    appendSystem(error.message || "插话失败");
  } finally {
    if (state.interjecting) {
      state.interjecting = false;
      applyPrivateAuthState();
    }
  }
}

async function waitForGroupRunToStop(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (isRunning("group") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return !isRunning("group");
}

async function sendKimiMessage(text, images = []) {
  if (!hasKimiKey()) {
    applyPrivateAuthState();
    return;
  }
  state.memorySyncVersion.kimi += 1;
  state.notices = state.notices.filter((notice) => notice.channel !== "kimi");
  const quote = state.composerQuotes.kimi;
  const optimistic = userMessage(text, "kimi", images, { quote });
  addMessage(optimistic, { forceBottom: true });
  clearComposer();
  setRunning(true, "kimi");
  setChannelStatus("kimi", "Kimi 正在输入…");
  state.drafts.kimi = null;
  await paintPendingUi();
  let accepted = false;
  let finished = false;
  try {
    const headers = { "content-type": "application/json" };
    if (state.kimiKey) headers["x-kimi-api-key"] = state.kimiKey;
    const response = await apiFetch("/api/kimi/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: state.sessionId, messageId: optimistic.id, text, quote, images: serializeImages(images) }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `请求失败 (${response.status})`);
    }
    await consumeNdjson(response.body, (event) => {
      if (event.type === "accepted") accepted = true;
      if (event.type === "chat_done") finished = true;
      handlePrivateEvent(event, "kimi");
    });
    if (accepted && !finished) await recoverKimiResult(optimistic.id);
  } catch (error) {
    if (accepted || isTransientConnectionError(error)) await recoverKimiResult(optimistic.id);
    else appendPrivateNotice("kimi", error.name === "AbortError" ? "连接已停止" : `Kimi 回复失败：${error.message}`);
  } finally {
    state.drafts.kimi = null;
    renderHistory();
    setRunning(false, "kimi");
  }
}

async function sendGlmMessage(text, images = []) {
  if (!hasGlmKey()) {
    applyPrivateAuthState();
    return;
  }
  state.memorySyncVersion.glm += 1;
  state.notices = state.notices.filter((notice) => notice.channel !== "glm");
  const quote = state.composerQuotes.glm;
  const optimistic = userMessage(text, "glm", images, { quote });
  addMessage(optimistic, { forceBottom: true });
  clearComposer();
  setRunning(true, "glm");
  setChannelStatus("glm", "Shin 正在输入…");
  state.drafts.glm = null;
  await paintPendingUi();
  let accepted = false;
  let finished = false;
  try {
    const headers = { "content-type": "application/json" };
    if (state.glmKey) headers["x-glm-api-key"] = state.glmKey;
    const response = await apiFetch("/api/glm/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: state.sessionId, messageId: optimistic.id, text, quote, images: serializeImages(images) }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `请求失败 (${response.status})`);
    }
    await consumeNdjson(response.body, (event) => {
      if (event.type === "accepted") accepted = true;
      if (event.type === "chat_done") finished = true;
      handlePrivateEvent(event, "glm");
    });
    if (accepted && !finished) await recoverPrivateResult("glm", optimistic.id, "Shin");
  } catch (error) {
    if (accepted || isTransientConnectionError(error)) await recoverPrivateResult("glm", optimistic.id, "Shin");
    else appendPrivateNotice("glm", error.name === "AbortError" ? "连接已停止" : `Shin 回复失败：${error.message}`);
  } finally {
    state.drafts.glm = null;
    renderHistory();
    setRunning(false, "glm");
  }
}

async function sendGenMessage(text, images = []) {
  if (!state.genEnabled) return appendSystem("Gen 本地通道尚未连接");
  const workMode = state.genMode === "work";
  const workspace = selectedGenWorkspace();
  if (workMode && (!state.genWorkEnabled || !workspace)) return appendPrivateNotice("gen", "请选择可用的 Gen 工作区");
  state.memorySyncVersion.gen += 1;
  state.notices = state.notices.filter((notice) => notice.channel !== "gen");
  state.genRunContext = {
    mode: workMode ? "work" : "chat",
    workspaceId: workMode ? workspace.id : "",
    workspaceLabel: workMode ? workspace.label : "",
  };
  const quote = state.composerQuotes.gen;
  const optimistic = userMessage(text, "gen", images, { ...state.genRunContext, quote });
  addMessage(optimistic, { forceBottom: true });
  clearComposer();
  setRunning(true, "gen");
  state.drafts.gen = null;
  await paintPendingUi();
  let accepted = false;
  let finished = false;
  try {
    const response = await apiFetch("/api/gen/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        text,
        quote,
        images: serializeImages(images),
        mode: state.genRunContext.mode,
        workspaceId: state.genRunContext.workspaceId,
        messageId: optimistic.id,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `请求失败 (${response.status})`);
    }
    await consumeNdjson(response.body, (event) => {
      if (event.type === "accepted") accepted = true;
      if (event.type === "chat_done") finished = true;
      handlePrivateEvent(event, "gen");
    });
    if (accepted && !finished) {
      if (workMode) await recoverGenWorkResult(optimistic.id);
      else await recoverPrivateResult("gen", optimistic.id, "Gen");
    }
  } catch (error) {
    if (accepted || isTransientConnectionError(error)) {
      if (workMode) await recoverGenWorkResult(optimistic.id);
      else await recoverPrivateResult("gen", optimistic.id, "Gen");
    } else appendPrivateNotice("gen", error.name === "AbortError" ? "连接已停止" : `Gen 回复失败：${error.message}`);
  } finally {
    state.drafts.gen = null;
    state.genRunContext = null;
    renderHistory();
    setRunning(false, "gen");
  }
}

async function sendGenGuidance(text, images = []) {
  if (images.length) return appendPrivateNotice("gen", "任务进行中的补充指令暂时只支持文字。");
  const quote = state.composerQuotes.gen;
  const optimistic = userMessage(text, "gen", [], {
    mode: "guide",
    workspaceId: state.genRunContext?.workspaceId || "",
    workspaceLabel: state.genRunContext?.workspaceLabel || "",
    quote,
  });
  addMessage(optimistic, { forceBottom: true });
  clearComposer();
  try {
    const response = await apiFetch("/api/gen/guide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: state.sessionId, messageId: optimistic.id, text, quote }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
    if (payload.message) acceptOptimistic(payload.message, "gen");
    setChannelStatus("gen", "Gen 已收到补充，会继续处理…");
  } catch (error) {
    state.history = state.history.filter((message) => message.id !== optimistic.id);
    persistHistory();
    renderHistory();
    appendPrivateNotice("gen", `补充指令没有送达：${error.message}`);
  }
}

function userMessage(content, channel, images = [], metadata = {}) {
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
    mode: ["work", "guide"].includes(metadata.mode) ? metadata.mode : "chat",
    workspaceId: metadata.workspaceId || "",
    workspaceLabel: metadata.workspaceLabel || "",
    quote: normalizeClientQuote(metadata.quote),
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
    state.groupThinking.clear();
    setChannelStatus("group", `${event.initialRecipients.map((provider) => provider.label).join("、")} 已读`);
  }
  if (event.type === "speaker_start") {
    state.groupThinking.add(event.provider.id);
    renderGroupThinkingStatus();
  }
  if (event.type === "message") {
    state.groupThinking.delete(event.message.providerId);
    addMessage({ ...event.message, channel: "group" });
    renderGroupThinkingStatus();
  }
  if (event.type === "speaker_skip") {
    state.groupThinking.delete(event.provider.id);
    renderGroupThinkingStatus();
  }
  if (event.type === "speaker_error") {
    state.groupThinking.delete(event.provider.id);
    renderGroupThinkingStatus();
    appendSystem(`${event.provider.label} 回复失败：${event.message}`);
  }
  if (event.type === "run_error") appendSystem(event.message);
  if (event.type === "chat_done") {
    state.groupThinking.clear();
    const labels = { stopped: "已停止", safety_limit: "已自动暂停", idle: "" };
    setChannelStatus("group", labels[event.reason] || "");
    if (event.reason !== "stopped") scheduleGroupMemorySync(state.memorySyncVersion.group);
  }
}

function renderGroupThinkingStatus() {
  const names = state.providers
    .filter((provider) => state.groupThinking.has(provider.id))
    .map((provider) => provider.label);
  setChannelStatus("group", names.length ? `${names.join("、")} 正在输入…` : "");
}

function handlePrivateEvent(event, channel) {
  const profile = channel === "gen"
    ? { name: "Gen", providerId: "gen", model: state.genModel }
    : channel === "glm"
      ? { name: "Shin", providerId: "glm", model: state.glmModel }
      : { name: "Kimi", providerId: "kimi", model: state.kimiModel };
  if (event.type === "accepted" && event.message) acceptOptimistic(event.message, channel);
  if (event.type === "read") {
    const message = state.history.find((item) => item.id === event.messageId);
    if (message) message.readAt = event.readAt;
    persistHistory();
    if (message && messageChannel(message) === state.activeChat) replaceRenderedMessage(message);
  }
  if (event.type === "typing") {
    setChannelStatus(channel, channel === "gen" && state.genRunContext?.mode === "work"
      ? "Gen 正在干活…"
      : `${profile.name} 正在输入…`);
  }
  if (event.type === "thinking_delta" || event.type === "content_delta") {
    const draft = ensurePrivateDraft(channel, profile);
    if (event.type === "thinking_delta") draft.reasoning += event.delta;
    else draft.content += event.delta;
    setChannelStatus(channel, `${profile.name} 正在输入…`);
    scheduleDraftRender();
  }
  if (event.type === "tool_start" || event.type === "tool_done") {
    const isGenWork = channel === "gen" && state.genRunContext?.mode === "work";
    if (isGenWork) {
      setChannelStatus(channel, "Gen 正在干活…");
    } else {
      const draft = ensurePrivateDraft(channel, profile);
      const existing = draft.toolCalls.find((item) => item.name === event.name && item.status === "running");
      const activity = existing || { name: event.name, label: event.label || event.name, status: "running" };
      activity.status = event.type === "tool_done" ? (event.status || "done") : "running";
      if (!existing) draft.toolCalls.push(activity);
      if (activity.name === "web_search" || activity.label?.includes("搜索")) {
        setChannelStatus(channel, `${profile.name} 正在联网搜索…`);
      } else if (activity.label?.includes("网页")) {
        setChannelStatus(channel, `${profile.name} 正在读取网页…`);
      } else {
        setChannelStatus(channel, `${profile.name} 正在使用工具…`);
      }
      scheduleDraftRender();
    }
  }
  if (event.type === "message") {
    state.drafts[channel] = null;
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
    setChannelStatus(channel, event.reason === "stopped" ? "已停止" : "");
    setRunning(false, channel);
    if (channel === "kimi" && event.reason === "complete") scheduleMemorySync("kimi", "Kimi", state.memorySyncVersion.kimi);
    if (channel === "glm" && event.reason === "complete") scheduleMemorySync("glm", "Shin", state.memorySyncVersion.glm);
  }
}

function ensurePrivateDraft(channel, profile) {
  if (state.drafts[channel]) return state.drafts[channel];
  state.drafts[channel] = {
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
    mode: channel === "gen" && state.genRunContext?.mode === "work" ? "work" : "chat",
    workspaceId: channel === "gen" ? (state.genRunContext?.workspaceId || "") : "",
    workspaceLabel: channel === "gen" ? (state.genRunContext?.workspaceLabel || "") : "",
  };
  return state.drafts[channel];
}

function appendPrivateNotice(channel, text) {
  state.notices.push({ channel, text });
  state.notices = state.notices.slice(-20);
  renderHistory();
}

function scheduleMemorySync(namespace, name, version) {
  for (const delay of [1200, 3500, 8000, 12000, 20000, 30000, 65000]) {
    setTimeout(() => syncPrivateMemories(namespace, name, version), delay);
  }
}

function scheduleGroupMemorySync(version) {
  for (const delay of [1800, 6000, 15000, 30000, 65000]) {
    setTimeout(() => syncGroupMemories(version), delay);
  }
}

async function syncGroupMemories(version) {
  if (state.memorySyncVersion.group !== version) return;
  const response = await apiFetch("/api/state").catch(() => null);
  if (!response?.ok || state.memorySyncVersion.group !== version) return;
  const payload = await response.json().catch(() => ({}));
  const namespaces = new Set(["shared", "kimi", "glm", "g", "k"]);
  const fresh = (Array.isArray(payload.memories) ? payload.memories : []).filter((memory) => namespaces.has(memory.namespace));
  const previous = state.memories.filter((memory) => namespaces.has(memory.namespace));
  const previousById = new Map(previous.map((memory) => [memory.id, memory]));
  const freshById = new Map(fresh.map((memory) => [memory.id, memory]));
  const changes = [];
  for (const memory of fresh) {
    const old = previousById.get(memory.id);
    const owner = memoryOwner(memory.namespace);
    if (!old) changes.push(`${owner} 记住了：${memory.text}`);
    else if (old.text !== memory.text || old.updatedAt !== memory.updatedAt) changes.push(`${owner} 更新了记忆：${memory.text}`);
  }
  for (const memory of previous) {
    if (!freshById.has(memory.id)) changes.push(`${memoryOwner(memory.namespace)} 忘掉了：${memory.text}`);
  }
  state.memories = [...state.memories.filter((memory) => !namespaces.has(memory.namespace)), ...fresh];
  for (const text of changes) state.notices.push({ channel: "group", text });
  state.notices = state.notices.slice(-20);
  renderMemories();
  renderHistory();
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
  if (channel === state.activeChat) replaceRenderedMessage(optimistic);
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
  const memories = memoriesForChat(state.activeChat);
  els.memoryTitle.textContent = state.activeChat === "kimi" ? "Kimi 的记忆" : state.activeChat === "glm" ? "Shin 的记忆" : state.activeChat === "gen" ? "Gen 的记忆" : "群聊记忆";
  els.memoryInput.placeholder = state.activeChat === "kimi" ? "让 Kimi 记住…" : state.activeChat === "glm" ? "让 Shin 记住…" : state.activeChat === "gen" ? "让 Gen 记住…" : "记住一件事";
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
      text.textContent = state.activeChat === "group" ? `${memoryOwner(memory.namespace)} · ${memory.text}` : memory.text;
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
  if (els.chatInfoMemoryCount) els.chatInfoMemoryCount.textContent = `${memories.length} 条`;
}

function memoriesForChat(chat) {
  const namespace = memoryNamespace(chat);
  return chat === "group"
    ? state.memories.filter((memory) => ["shared", "kimi", "glm", "g", "k"].includes(memory.namespace))
    : state.memories.filter((memory) => memory.namespace === namespace);
}

function memoryOwner(namespace) {
  if (namespace === "kimi") return "Kimi";
  if (namespace === "g") return "Gen";
  if (namespace === "k") return "K";
  if (namespace === "glm") return "Shin";
  return "共享";
}

function renderHistory({ forceBottom = false, animateMessageId = "" } = {}) {
  const followLatest = forceBottom || isNearBottom();
  const previousScrollTop = els.chat.scrollTop;
  if (draftRenderFrame) {
    cancelAnimationFrame(draftRenderFrame);
    draftRenderFrame = 0;
  }
  els.messages.replaceChildren();
  const visible = state.history.filter((message) => messageChannel(message) === state.activeChat && !isMessageHidden(message));
  const draft = state.drafts[state.activeChat] || null;
  visible.forEach((message) => renderMessage(message, message.id === animateMessageId));
  if (draft) renderMessage(draft, false);
  const notices = state.notices.filter((notice) => notice.channel === state.activeChat);
  for (const notice of notices) {
    const item = document.createElement("div");
    item.className = "system-message";
    item.textContent = notice.text;
    els.messages.append(item);
  }
  const hasContent = visible.length > 0 || Boolean(draft) || notices.length > 0;
  els.empty.hidden = hasContent || !els.kimiSetup.hidden || (els.glmSetup && !els.glmSetup.hidden) || (state.activeChat === "gen" && !state.genEnabled);
  updateEarlierButton();
  if (followLatest) scrollToBottom(false);
  else els.chat.scrollTop = previousScrollTop;
}

function addMessage(message, { forceBottom = false } = {}) {
  if (state.history.some((item) => item.id === message.id)) return;
  state.history.push(message);
  persistHistory();
  if (isActiveChatVisible() && messageChannel(message) === state.activeChat) markChatRead(state.activeChat, false);
  renderConversationList();
  if (messageChannel(message) !== state.activeChat) return;
  const activeDraft = state.drafts[state.activeChat];
  const notices = state.notices.filter((notice) => notice.channel === state.activeChat);
  if (activeDraft || notices.length) {
    renderHistory({ forceBottom, animateMessageId: message.id });
    return;
  }
  const followLatest = forceBottom || isNearBottom();
  els.messages.querySelector(`[data-message-id="${messageChannel(message)}-draft"]`)?.remove();
  els.messages.querySelectorAll(".system-message").forEach((item) => item.remove());
  els.empty.hidden = true;
  renderMessage(message, true);
  if (followLatest) scrollToBottom(false);
}

function replaceRenderedMessage(message) {
  const current = els.messages.querySelector(`[data-message-id="${message.id}"]`);
  if (!current) return;
  current.replaceWith(createMessageElement(message));
}

function renderMessage(message, animate = false) {
  els.messages.append(createMessageElement(message, { animate }));
}

function createMessageElement(message, { animate = false } = {}) {
  const article = document.createElement("article");
  article.className = `message ${message.role === "user" ? "user" : "assistant"}${animate ? " message-enter" : ""}`;
  article.dataset.provider = message.providerId || "user";
  article.dataset.messageId = message.id || "";
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  applyAvatarElement(avatar, avatarIdForMessage(message));
  const body = document.createElement("div");
  body.className = "message-body";
  const visibleContent = displayMessageContent(message);
  if (visibleContent) {
    body.classList.add("copyable");
    body.dataset.copyText = visibleContent;
    body.title = "长按操作";
  }
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const name = document.createElement("strong");
  name.textContent = message.role === "user" ? "你" : displayAuthor(message);
  const detail = document.createElement("span");
  const labels = [];
  if (message.triggeredBy) labels.push(`回复 ${message.triggeredBy === "用户" ? "Okra" : message.triggeredBy === "GLM" ? "Shin" : message.triggeredBy}`);
  if (message.role === "user" && ["kimi", "gen", "glm"].includes(messageChannel(message)) && message.readAt) {
    labels.push("已读");
    detail.classList.add("read-label");
  }
  if (messageChannel(message) === "gen" && message.mode === "work") {
    labels.unshift(`任务 · ${message.workspaceLabel || "工作区"}`);
  }
  if (messageChannel(message) === "gen" && message.mode === "guide") labels.unshift("补充指令");
  if (message.proactive) labels.unshift("主动消息");
  const time = formatTime(message.createdAt);
  if (time) labels.push(time);
  detail.textContent = labels.join(" · ");
  meta.append(name, detail);
  body.append(meta);

  const quote = normalizeClientQuote(message.quote);
  if (quote) {
    const quoted = document.createElement("div");
    quoted.className = "message-quote";
    const quotedAuthor = document.createElement("strong");
    quotedAuthor.textContent = `${quote.author}：`;
    quoted.append(quotedAuthor, document.createTextNode(quote.text));
    body.append(quoted);
  }

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length) {
    const gallery = document.createElement("div");
    gallery.className = "message-images";
    for (const attachment of attachments) {
      if (attachment?.type !== "image" || !attachment.url) continue;
      const image = document.createElement("img");
      image.src = imageVariantUrl(attachment.url, 720);
      image.alt = attachment.name || "聊天图片";
      image.loading = "lazy";
      image.addEventListener("click", () => openImageLightbox(attachment.url, image.alt));
      gallery.append(image);
    }
    if (gallery.childElementCount) body.append(gallery);
  }

  if (message.role === "assistant" && message.mode !== "work" && (message.pending || (Array.isArray(message.toolCalls) && message.toolCalls.length))) {
    const tools = document.createElement("div");
    tools.className = "tool-calls";
    tools.dataset.part = "tools";
    for (const call of message.toolCalls || []) {
      const item = document.createElement("span");
      updateToolElement(item, call);
      tools.append(item);
    }
    tools.hidden = !tools.childElementCount;
    body.append(tools);
  }

  if (message.role === "assistant" && (message.reasoning || message.pending)) {
    const panel = document.createElement("div");
    panel.className = "thinking-panel";
    panel.dataset.part = "thinking";
    panel.hidden = !message.reasoning;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "thinking-toggle";
    const expanded = Boolean(message.pending);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "收起思考过程" : "查看思考过程";
    const reasoning = document.createElement("div");
    reasoning.className = "thinking-content";
    reasoning.dataset.part = "reasoning";
    reasoning.textContent = message.reasoning;
    reasoning.hidden = !expanded;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const nextExpanded = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(nextExpanded));
      toggle.textContent = nextExpanded ? "收起思考过程" : "查看思考过程";
      reasoning.hidden = !nextExpanded;
    });
    panel.append(toggle, reasoning);
    body.append(panel);
  }
  if (visibleContent || message.pending) {
    const content = document.createElement("div");
    content.className = "message-content";
    content.dataset.part = "content";
    appendRichText(content, visibleContent);
    content.hidden = !visibleContent;
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
  const draft = state.drafts[state.activeChat];
  if (!draft || messageChannel(draft) !== state.activeChat) return;
  const followLatest = isNearBottom();
  let article = els.messages.querySelector(`[data-message-id="${draft.id}"]`);
  if (!article) {
    renderMessage(draft, false);
    if (followLatest) els.chat.scrollTop = els.chat.scrollHeight;
    return;
  }
  const reasoning = article.querySelector('[data-part="reasoning"]');
  const thinking = article.querySelector('[data-part="thinking"]');
  const content = article.querySelector('[data-part="content"]');
  const tools = article.querySelector('[data-part="tools"]');
  const visibleContent = displayMessageContent(draft);
  const needsStructureRefresh = !reasoning || !thinking || !content || !tools;
  if (needsStructureRefresh) {
    const replacement = createMessageElement(draft, { animate: false });
    article.replaceWith(replacement);
    article = replacement;
  } else {
    if (reasoning.textContent !== draft.reasoning) reasoning.textContent = draft.reasoning;
    thinking.hidden = !draft.reasoning;
    if (content && content.textContent !== visibleContent) {
      content.textContent = visibleContent;
    }
    content.hidden = !visibleContent;
    syncToolElements(tools, draft.toolCalls || []);
  }
  if (followLatest) els.chat.scrollTop = els.chat.scrollHeight;
}

function syncToolElements(container, calls) {
  while (container.children.length > calls.length) container.lastElementChild.remove();
  while (container.children.length < calls.length) container.append(document.createElement("span"));
  [...container.children].forEach((item, index) => updateToolElement(item, calls[index]));
  container.hidden = !calls.length;
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
  const followLatest = isNearBottom();
  const item = document.createElement("div");
  item.className = "system-message";
  item.textContent = text;
  els.empty.hidden = true;
  els.messages.append(item);
  if (followLatest) scrollToBottom(false);
}

function setActiveChat(chat, shouldClose = true) {
  if (!["group", "kimi", "gen", "glm"].includes(chat)) return;
  closeMessageActions();
  const previousChat = state.activeChat;
  if (previousChat !== chat) saveComposerDraft(previousChat);
  state.activeChat = chat;
  document.body.dataset.chat = chat;
  localStorage.setItem("roundtable.activeChat", chat);
  els.conversationCards.forEach((card) => card.classList.toggle("active", card.dataset.chat === chat));
  const isKimi = chat === "kimi";
  const isGen = chat === "gen";
  const isGlm = chat === "glm";
  const isPrivate = isKimi || isGen || isGlm;
  els.groupAvatar.hidden = isPrivate;
  els.privateAvatar.hidden = !isPrivate;
  els.privateAvatar.classList.toggle("kimi-avatar", isKimi);
  els.privateAvatar.classList.toggle("gen-avatar", isGen);
  els.privateAvatar.classList.toggle("glm-avatar", isGlm);
  if (isPrivate) applyAvatarElement(els.privateAvatar, isKimi ? "kimi" : isGlm ? "glm" : "gen");
  els.relayControl.hidden = isPrivate;
  if (els.genWorkbar) els.genWorkbar.hidden = !isGen;
  els.kimiSettings.hidden = !(isKimi || isGlm);
  els.membersSection.hidden = isPrivate;
  els.turnBudget.hidden = isPrivate;
  els.mentionBar.hidden = isPrivate;
  els.channelName.textContent = isKimi ? "Kimi" : isGlm ? "Shin" : isGen ? "Gen" : "客厅";
  els.emptyAvatar.className = `empty-avatar${isGen ? " gen-avatar" : isKimi ? " kimi-avatar" : isGlm ? " glm-avatar" : ""}`;
  if (isPrivate) applyAvatarElement(els.emptyAvatar, isKimi ? "kimi" : isGlm ? "glm" : "gen");
  else {
    delete els.emptyAvatar.dataset.avatarId;
    els.emptyAvatar.classList.remove("has-photo");
    els.emptyAvatar.style.backgroundImage = "";
    els.emptyAvatar.textContent = "客";
  }
  els.emptyName.textContent = isKimi ? "Kimi" : isGlm ? "Shin" : isGen ? "Gen" : "客厅";
  els.emptyCopy.textContent = isPrivate ? "开始聊天" : "发条消息吧";
  els.chat.setAttribute("aria-label", isKimi ? "与 Kimi 私聊" : isGlm ? "与 Shin 私聊" : isGen ? "与 Gen 私聊" : "群聊");
  els.input.placeholder = "";
  restoreComposerDraft(chat);
  renderComposerQuote();
  renderGenWorkbar();
  applyPrivateAuthState();
  renderRunningState();
  updateHeader();
  applyChatBackground();
  renderChatInfo();
  renderMemories();
  renderHistory({ forceBottom: true });
  updateEarlierButton();
  renderAvatars();
  if (shouldClose || isActiveChatVisible()) markChatRead(chat, false);
  renderConversationList();
  if (shouldClose) {
    pushConversationHistory(chat);
    els.shell.classList.add("conversation-open");
    closeSidebar();
    closeChatInfo();
    closeMemoryPanel();
  }
}

function applyPrivateAuthState() {
  const kimiLocked = state.activeChat === "kimi" && !hasKimiKey();
  const glmLocked = state.activeChat === "glm" && (!state.glmEnabled || !hasGlmKey());
  const genLocked = state.activeChat === "gen" && !state.genEnabled;
  const locked = kimiLocked || glmLocked || genLocked;
  const runningHere = isRunning(state.activeChat);
  const canInterject = runningHere && state.activeChat === "group" && !state.interjecting;
  const canGuide = runningHere && state.activeChat === "gen" && state.genRunContext?.mode === "work";
  const busy = (state.activeChat === "group" && state.interjecting) || (runningHere && !canInterject && !canGuide);
  els.kimiSetup.hidden = !kimiLocked;
  if (els.glmSetup) els.glmSetup.hidden = !glmLocked;
  els.composerWrap.classList.toggle("locked", locked);
  els.input.disabled = locked;
  els.attachButton.disabled = locked || busy || canGuide;
  els.imageInput.disabled = locked || busy || canGuide;
  els.send.disabled = locked || busy;
  els.genModeButtons.forEach((button) => { button.disabled = busy || (button.dataset.genMode === "work" && !state.genWorkEnabled); });
  if (els.genWorkspace) els.genWorkspace.disabled = busy;
  els.send.title = canGuide ? "补充指令" : canInterject ? "插话并开始新一轮" : "发送";
  if (locked) els.empty.hidden = true;
}

function updateHeader() {
  const selected = state.providers.filter((provider) => provider.available && state.selected.has(provider.id));
  const memberCount = selected.length + 1;
  els.participantCount.textContent = String(memberCount);
  els.turnBudget.textContent = `每人最多 ${state.maxRepliesPerMember} 轮`;
  renderConversationList();
  if (state.activeChat === "kimi") {
    const status = hasKimiKey() ? `${state.kimiModel} · 在线` : `${state.kimiModel} · 需要 API Key`;
    els.channelSubtitle.textContent = status;
  } else if (state.activeChat === "glm") {
    els.channelSubtitle.textContent = hasGlmKey() ? `${state.glmModel} · 在线` : `${state.glmModel} · 需要 API Key`;
  } else if (state.activeChat === "gen") {
    const workspace = selectedGenWorkspace();
    const status = state.genEnabled
      ? state.genMode === "work" ? `干活 · ${workspace?.label || "工作区"}` : `${state.genModel} · 在线`
      : "本地通道未连接";
    els.channelSubtitle.textContent = status;
  } else {
    els.channelSubtitle.textContent = `${memberCount} 位成员`;
  }
}

function readSeenAt() {
  try {
    const parsed = JSON.parse(localStorage.getItem("roundtable.seenAt") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function initializeSeenState() {
  if (state.hasSeenState) return;
  for (const channel of ["group", "gen", "kimi", "glm"]) {
    const latest = latestAssistantMessage(channel);
    state.seenAt[channel] = messageTimeValue(latest);
  }
  state.hasSeenState = true;
  persistSeenAt();
}

function persistSeenAt() {
  localStorage.setItem("roundtable.seenAt", JSON.stringify(state.seenAt));
}

function isActiveChatVisible() {
  return els.shell.classList.contains("conversation-open") && document.visibilityState !== "hidden";
}

function markChatRead(channel, shouldRender = true) {
  const latest = latestMessage(channel);
  state.seenAt[channel] = Math.max(Date.now(), messageTimeValue(latest), Number(state.seenAt[channel] || 0));
  state.hasSeenState = true;
  persistSeenAt();
  if (shouldRender) renderConversationList();
}

function latestMessage(channel) {
  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    const message = state.history[index];
    if (messageChannel(message) === channel && !message.pending && !isMessageHidden(message)) return message;
  }
  return null;
}

function latestAssistantMessage(channel) {
  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    const message = state.history[index];
    if (messageChannel(message) === channel && message.role === "assistant" && !message.pending && !isMessageHidden(message)) return message;
  }
  return null;
}

function messageTimeValue(message) {
  const value = Date.parse(message?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function renderConversationList() {
  const previewElements = {
    group: els.groupCardPreview,
    gen: els.genCardPreview,
    kimi: els.kimiCardPreview,
    glm: els.glmCardPreview,
  };
  const emptyPreviews = {
    group: "Okra、Gen、Kimi、Shin、K",
    gen: state.genEnabled ? `${state.genModel} · 在线` : "本地通道未连接",
    kimi: hasKimiKey() ? `${state.kimiModel} · 在线` : `${state.kimiModel} · 需要 API Key`,
    glm: hasGlmKey() ? `${state.glmModel} · 在线` : `${state.glmModel} · 需要 API Key`,
  };
  for (const card of els.conversationCards) {
    const channel = card.dataset.chat;
    if (!channel) continue;
    const latest = latestMessage(channel);
    const latestAssistant = latestAssistantMessage(channel);
    const preview = previewElements[channel];
    const time = card.querySelector("time");
    if (preview) preview.textContent = latest ? conversationPreview(latest) : (emptyPreviews[channel] || "");
    if (time) time.textContent = latest ? formatConversationTime(latest.createdAt) : "";
    const dot = card.querySelector(`[data-unread="${channel}"]`);
    if (dot) dot.hidden = !latestAssistant || messageTimeValue(latestAssistant) <= Number(state.seenAt[channel] || 0);
  }
}

function conversationPreview(message) {
  const content = displayMessageContent(message).replace(/\s+/gu, " ").trim();
  if (content) return message.role === "user" ? `你：${content}` : content;
  if ((message.attachments || []).some((item) => item?.type === "image")) return message.role === "user" ? "你：[图片]" : "[图片]";
  return message.mode === "work" ? "任务已更新" : "新消息";
}

function formatConversationTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const difference = Math.round((today - day) / 86_400_000);
  if (difference === 0) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (difference === 1) return "昨天";
  if (difference > 1 && difference < 7) return date.toLocaleDateString("zh-CN", { weekday: "short" });
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function renderGenWorkbar() {
  // A phone browser can briefly combine a cached HTML shell with a newer JS
  // file after deployment. Optional controls must never block chat history.
  if (!els.genWorkbar || !els.genWorkspace || !els.genWorkspaceWrap) return;
  const workMode = state.genMode === "work";
  els.genModeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.genMode === state.genMode));
    button.disabled = isRunning("gen") || (button.dataset.genMode === "work" && !state.genWorkEnabled);
  });
  const currentOptions = [...els.genWorkspace.options].map((option) => option.value).join("\n");
  const nextOptions = state.genWorkspaces.map((workspace) => workspace.id).join("\n");
  if (currentOptions !== nextOptions) {
    els.genWorkspace.replaceChildren(...state.genWorkspaces.map((workspace) => {
      const option = document.createElement("option");
      option.value = workspace.id;
      option.textContent = workspace.label;
      return option;
    }));
  }
  els.genWorkspace.value = state.genWorkspaceId;
  els.genWorkspace.disabled = isRunning("gen");
  els.genWorkspaceWrap.hidden = !workMode;
  els.input.placeholder = "";
}

function selectedGenWorkspace() {
  return state.genWorkspaces.find((workspace) => workspace.id === state.genWorkspaceId) || state.genWorkspaces[0] || null;
}

function isRunning(channel) {
  return state.runningChannels.has(channel);
}

function setChannelStatus(channel, value) {
  state.runStatus[channel] = value;
  if (state.activeChat === channel) renderRunningState();
}

function setRunning(running, channel = state.activeChat) {
  if (running) state.runningChannels.add(channel);
  else {
    state.runningChannels.delete(channel);
    if (channel === "group") state.groupThinking.clear();
  }
  const groupRunning = isRunning("group");
  els.providerList.querySelectorAll("input").forEach((input) => {
    input.disabled = groupRunning || input.closest("label").classList.contains("disabled");
  });
  els.relayToggle.disabled = groupRunning;
  applyPrivateAuthState();
  renderGenWorkbar();
  renderRunningState();
  if (!running) {
    setTimeout(() => {
      if (!isRunning(channel)) {
        state.runStatus[channel] = "";
        if (state.activeChat === channel) renderRunningState();
      }
    }, 1600);
  }
}

async function recoverGroupResult(messageId = "") {
  state.groupThinking.clear();
  setChannelStatus("group", "连接暂时中断，大家仍在后台回复…");
  while (true) {
    try {
      const query = new URLSearchParams({ sessionId: state.sessionId });
      if (messageId) query.set("messageId", messageId);
      const response = await apiFetch(`/api/group/status?${query}`);
      if (response.ok) {
        const payload = await response.json();
        await syncServerMessages();
        if (!payload.running) {
          setChannelStatus("group", "");
          if (payload.knownUser || !messageId) {
            scheduleGroupMemorySync(state.memorySyncVersion.group);
            return true;
          }
          return false;
        }
        setChannelStatus("group", "大家正在后台回复…");
      }
    } catch { /* the phone may still be reconnecting */ }
    await new Promise((resolve) => setTimeout(resolve, document.visibilityState === "hidden" ? 5_000 : 1_500));
  }
}

async function resumePendingGroupReply() {
  if (isRunning("group")) return;
  try {
    const response = await apiFetch(`/api/group/status?sessionId=${encodeURIComponent(state.sessionId)}`);
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload.running) return;
    setRunning(true, "group");
    await recoverGroupResult();
  } finally {
    if (isRunning("group")) setRunning(false, "group");
  }
}

async function recoverGenWorkResult(messageId) {
  state.drafts.gen = null;
  renderHistory();
  setChannelStatus("gen", "连接中断，Gen 仍在后台干活…");
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      const response = await apiFetch(`/api/gen/status?sessionId=${encodeURIComponent(state.sessionId)}&messageId=${encodeURIComponent(messageId)}`);
      if (response.ok) {
        const payload = await response.json();
        if (payload.message) {
          addMessage(payload.message, { forceBottom: true });
          setChannelStatus("gen", "");
          return true;
        }
        if (!payload.running) {
          appendPrivateNotice("gen", payload.knownUser ? "这次任务已中断，没有产生结果，请重新发送。" : "没有找到这次任务，请重新发送。");
          return false;
        }
      }
    } catch { /* phone may still be reconnecting */ }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  appendPrivateNotice("gen", "暂时没有取回任务结果；刷新页面后会从服务器同步已完成的回复。");
  return false;
}

async function recoverKimiResult(messageId) {
  state.drafts.kimi = null;
  renderHistory();
  setChannelStatus("kimi", "连接波动，Kimi 仍在回复…");
  const deadline = Date.now() + 320_000;
  while (Date.now() < deadline) {
    try {
      const response = await apiFetch(`/api/kimi/status?sessionId=${encodeURIComponent(state.sessionId)}&messageId=${encodeURIComponent(messageId)}`);
      if (response.ok) {
        const payload = await response.json();
        if (payload.message) {
          addMessage(payload.message, { forceBottom: true });
          setChannelStatus("kimi", "");
          return true;
        }
        if (!payload.running) {
          if (payload.knownUser) appendPrivateNotice("kimi", "Kimi 这次没有产生回复，请重新发送一次。");
          return false;
        }
      }
    } catch { /* phone may still be reconnecting */ }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  appendPrivateNotice("kimi", "暂时没有取回 Kimi 的回复；刷新页面后会从服务器同步结果。");
  return false;
}

async function recoverPrivateResult(channel, messageId, name) {
  state.drafts[channel] = null;
  renderHistory();
  setChannelStatus(channel, `连接波动，${name} 仍在回复…`);
  const deadline = Date.now() + 320_000;
  while (Date.now() < deadline) {
    try {
      const response = await apiFetch(`/api/${channel}/status?sessionId=${encodeURIComponent(state.sessionId)}&messageId=${encodeURIComponent(messageId)}`);
      if (response.ok) {
        const payload = await response.json();
        if (payload.message) {
          addMessage(payload.message, { forceBottom: true });
          setChannelStatus(channel, "");
          return true;
        }
        if (!payload.running) {
          if (payload.knownUser) appendPrivateNotice(channel, `${name} 这次没有产生回复，请重新发送一次。`);
          return false;
        }
      }
    } catch { /* phone may still be reconnecting */ }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  appendPrivateNotice(channel, `暂时没有取回 ${name} 的回复；刷新页面后会从服务器同步结果。`);
  return false;
}

async function resumePendingKimiReply() {
  const replies = new Set(state.history.filter((message) => message.role === "assistant" && message.channel === "kimi").map((message) => message.replyToId));
  const pending = [...state.history].reverse().find((message) => (
    message.channel === "kimi" && message.role === "user" && !replies.has(message.id)
  ));
  if (!pending || isRunning("kimi")) return;
  try {
    const response = await apiFetch(`/api/kimi/status?sessionId=${encodeURIComponent(state.sessionId)}&messageId=${encodeURIComponent(pending.id)}`);
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.message) return addMessage(payload.message);
    if (!payload.running) return;
    setRunning(true, "kimi");
    setChannelStatus("kimi", "Kimi 正在输入…");
    await recoverKimiResult(pending.id);
  } finally {
    if (isRunning("kimi")) setRunning(false, "kimi");
  }
}

async function resumePendingGlmReply() {
  const replies = new Set(state.history.filter((message) => message.role === "assistant" && message.channel === "glm").map((message) => message.replyToId));
  const pending = [...state.history].reverse().find((message) => (
    message.channel === "glm" && message.role === "user" && !replies.has(message.id)
  ));
  if (!pending || isRunning("glm")) return;
  try {
    const response = await apiFetch(`/api/glm/status?sessionId=${encodeURIComponent(state.sessionId)}&messageId=${encodeURIComponent(pending.id)}`);
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.message) return addMessage(payload.message);
    if (!payload.running) return;
    setRunning(true, "glm");
    setChannelStatus("glm", "Shin 正在输入…");
    await recoverPrivateResult("glm", pending.id, "Shin");
  } finally {
    if (isRunning("glm")) setRunning(false, "glm");
  }
}

async function resumePendingGenReply() {
  const replies = new Set(state.history.filter((message) => message.role === "assistant").map((message) => message.replyToId));
  const pending = [...state.history].reverse().find((message) => (
    message.channel === "gen" && message.role === "user" && message.mode !== "guide" && !replies.has(message.id)
  ));
  if (!pending || isRunning("gen")) return;
  try {
    const response = await apiFetch(`/api/gen/status?sessionId=${encodeURIComponent(state.sessionId)}&messageId=${encodeURIComponent(pending.id)}`);
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.message) return addMessage(payload.message);
    if (!payload.running) return;
    const workMode = pending.mode === "work";
    state.genRunContext = {
      mode: workMode ? "work" : "chat",
      workspaceId: pending.workspaceId || "",
      workspaceLabel: pending.workspaceLabel || "",
    };
    setRunning(true, "gen");
    setChannelStatus("gen", workMode ? "Gen 正在干活…" : "Gen 正在后台回复…");
    if (workMode) await recoverGenWorkResult(pending.id);
    else await recoverPrivateResult("gen", pending.id, "Gen");
  } finally {
    if (isRunning("gen")) setRunning(false, "gen");
    state.genRunContext = null;
  }
}

function renderRunningState() {
  const runningHere = isRunning(state.activeChat);
  const status = state.runStatus[state.activeChat] || "";
  els.stop.hidden = !runningHere;
  els.status.textContent = status;
  els.status.hidden = !runningHere && !status;
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
  saveActiveComposerDraft();
}

function resizeInput() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(els.input.scrollHeight, 130)}px`;
}

function readComposerDrafts() {
  const empty = { group: "", gen: "", kimi: "", glm: "" };
  try {
    const stored = JSON.parse(localStorage.getItem("roundtable.composerDrafts.v1") || "{}");
    for (const channel of Object.keys(empty)) {
      if (typeof stored[channel] === "string") empty[channel] = stored[channel].slice(0, 8_000);
    }
  } catch { /* use empty drafts */ }
  return empty;
}

function persistComposerDrafts() {
  localStorage.setItem("roundtable.composerDrafts.v1", JSON.stringify(state.composerDrafts));
}

function saveComposerDraft(channel) {
  if (!["group", "gen", "kimi", "glm"].includes(channel)) return;
  state.composerDrafts[channel] = els.input.value.slice(0, 8_000);
  state.composerImages[channel] = state.pendingImages;
  persistComposerDrafts();
}

function saveActiveComposerDraft() {
  saveComposerDraft(state.activeChat);
}

function restoreComposerDraft(channel) {
  els.input.value = state.composerDrafts[channel] || "";
  state.pendingImages = state.composerImages[channel] || [];
  renderImagePreview();
  resizeInput();
}

function clearComposer() {
  els.input.value = "";
  els.input.style.height = "auto";
  state.pendingImages = [];
  state.composerDrafts[state.activeChat] = "";
  state.composerImages[state.activeChat] = [];
  state.composerQuotes[state.activeChat] = null;
  persistComposerDrafts();
  els.imageInput.value = "";
  renderImagePreview();
  renderComposerQuote();
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
    const prepared = await optimizeImageForSend(file);
    state.pendingImages.push({
      id: crypto.randomUUID(),
      name: file.name,
      type: prepared.type,
      dataUrl: prepared.dataUrl,
    });
  }
  if (files.length > available) appendSystem("一次最多发送 4 张图片");
  state.composerImages[state.activeChat] = state.pendingImages;
  renderImagePreview();
}

async function optimizeImageForSend(file) {
  if (file.type === "image/gif") return { type: file.type, dataUrl: await readFileAsDataUrl(file) };
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`无法读取 ${file.name}`));
      element.src = objectUrl;
    });
    const maxDimension = 1800;
    const largestSide = Math.max(image.naturalWidth || 1, image.naturalHeight || 1);
    if (file.size <= 900_000 && largestSide <= maxDimension) {
      return { type: file.type, dataUrl: await readFileAsDataUrl(file) };
    }
    const scale = Math.min(1, maxDimension / largestSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    if (dataUrl.length > 2_800_000) dataUrl = canvas.toDataURL("image/jpeg", 0.74);
    return { type: "image/jpeg", dataUrl };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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

function paintPendingUi() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function hasKimiKey() {
  return Boolean(state.kimiKey || state.kimiEnvAvailable);
}

function hasGlmKey() {
  return Boolean(state.glmKey || state.glmEnvAvailable);
}

function messageChannel(message) {
  return ["kimi", "gen", "glm"].includes(message?.channel) ? message.channel : "group";
}

function memoryNamespace(chat) {
  if (chat === "kimi") return "kimi";
  if (chat === "gen") return "g";
  if (chat === "glm") return "glm";
  return "shared";
}

function avatarLabel(message) {
  if (message?.providerId === "gen" || message?.author === "Gen") return "G";
  if (message?.providerId === "kimi" || message?.author === "Kimi") return "Ki";
  if (message?.providerId === "glm" || ["Shin", "GLM"].includes(message?.author)) return "S";
  if (["anthropic", "claude-code"].includes(message?.providerId) || message?.author === "K") return "K";
  return initials(message?.author || "AI");
}

function avatarIdForMessage(message) {
  if (message?.role === "user") return "okra";
  if (message?.providerId === "gen" || ["Gen", "G老师"].includes(message?.author)) return "gen";
  if (message?.providerId === "kimi" || message?.author === "Kimi") return "kimi";
  if (message?.providerId === "glm" || ["Shin", "GLM"].includes(message?.author)) return "glm";
  if (["anthropic", "claude-code", "k"].includes(message?.providerId) || message?.author === "K") return "k";
  return "";
}

function avatarFallback(id) {
  return ({ okra: "O", gen: "G", kimi: "Ki", glm: "S", k: "K" })[id] || "AI";
}

function displayAuthor(message) {
  return message?.providerId === "glm" || ["Shin", "GLM"].includes(message?.author) ? "Shin" : (message?.author || "AI");
}

function applyAvatarElement(element, id) {
  if (!element) return;
  if (!id) {
    delete element.dataset.avatarId;
    element.classList.remove("has-photo");
    element.style.backgroundImage = "";
    element.textContent = "AI";
    return;
  }
  element.dataset.avatarId = id;
  const url = state.avatars[id] || "";
  element.classList.toggle("has-photo", Boolean(url));
  element.style.backgroundImage = url ? `url("${imageVariantUrl(url, 192)}")` : "";
  element.textContent = url ? "" : avatarFallback(id);
}

function renderAvatars() {
  document.querySelectorAll("[data-avatar-id]").forEach((element) => applyAvatarElement(element, element.dataset.avatarId));
  memberProfile.refresh();
}

async function uploadAvatar(id, image) {
  if (els.avatarStatus) els.avatarStatus.textContent = "正在上传头像…";
  try {
    const response = await apiFetch(`/api/avatars/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "头像上传失败");
    state.avatars[id] = payload.avatar.url;
    persistUiState();
    renderAvatars();
    renderHistory();
    if (els.avatarStatus) els.avatarStatus.textContent = `${({ okra: "Okra", gen: "Gen", kimi: "Kimi", glm: "Shin", k: "K" })[id]} 的头像已更新`;
    return payload.avatar;
  } catch (error) {
    if (els.avatarStatus) els.avatarStatus.textContent = error.message || "头像上传失败";
    throw error;
  }
}

async function resetAvatar(id) {
  if (!state.avatars[id]) return;
  const response = await apiFetch(`/api/avatars/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("恢复默认头像失败");
  delete state.avatars[id];
  persistUiState();
  renderAvatars();
  renderHistory();
  if (els.avatarStatus) els.avatarStatus.textContent = "已恢复默认头像";
}

async function saveProfileSignature(id, signature) {
  const response = await apiFetch(`/api/profiles/${encodeURIComponent(id)}/signature`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signature }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "个性签名保存失败");
  if (payload.profile?.signature) state.signatures[id] = payload.profile.signature;
  else delete state.signatures[id];
  persistUiState();
  return payload.profile;
}

function imageVariantUrl(url, width) {
  if (!String(url || "").startsWith("/uploads/")) return url;
  const next = new URL(url, location.origin);
  next.searchParams.set("w", String(width));
  return `${next.pathname}${next.search}`;
}

function readCachedUiState() {
  try {
    const cached = JSON.parse(localStorage.getItem("roundtable.uiState.v1") || "{}");
    return {
      avatars: cached.avatars && typeof cached.avatars === "object" ? cached.avatars : {},
      signatures: cached.signatures && typeof cached.signatures === "object" ? cached.signatures : {},
      chatBackgrounds: cached.chatBackgrounds && typeof cached.chatBackgrounds === "object" ? cached.chatBackgrounds : {},
    };
  } catch {
    return { avatars: {}, signatures: {}, chatBackgrounds: {} };
  }
}

function persistUiState() {
  localStorage.setItem("roundtable.uiState.v1", JSON.stringify({
    avatars: state.avatars,
    signatures: state.signatures,
    chatBackgrounds: state.chatBackgrounds,
  }));
}

async function prepareAvatarImage(file) {
  if (!new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]).has(file.type)) {
    throw new Error("请选择 PNG、JPEG、WebP 或 GIF 图片");
  }
  if (file.size > 25_000_000) throw new Error("原图不能超过 25 MB");
  const source = await readFileAsDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("无法读取这张图片"));
    element.src = source;
  });
  return openAvatarCropper(image);
}

function openAvatarCropper(image) {
  if (!els.avatarCropDialog || !els.avatarCropCanvas || !els.avatarCropZoom) throw new Error("头像裁剪器没有加载完成");
  finishAvatarCrop(false);
  return new Promise((resolve) => {
    const zoom = avatarContainZoom(image);
    avatarCropSession = { image, zoom, offsetX: 0, offsetY: 0, drag: null, resolve };
    els.avatarCropZoom.value = String(zoom);
    els.avatarCropDialog.hidden = false;
    renderAvatarCrop();
    els.avatarCropConfirm?.focus();
  });
}

function avatarContainZoom(image) {
  const coverScale = Math.max(AVATAR_CROP_SIZE / image.naturalWidth, AVATAR_CROP_SIZE / image.naturalHeight);
  const containScale = Math.min(AVATAR_CROP_SIZE / image.naturalWidth, AVATAR_CROP_SIZE / image.naturalHeight);
  return Math.max(0.05, containScale / coverScale);
}

function renderAvatarCrop(targetCanvas = els.avatarCropCanvas) {
  if (!avatarCropSession || !targetCanvas) return;
  const { image, zoom, offsetX, offsetY } = avatarCropSession;
  const ratio = targetCanvas.width / AVATAR_CROP_SIZE;
  const baseScale = Math.max(AVATAR_CROP_SIZE / image.naturalWidth, AVATAR_CROP_SIZE / image.naturalHeight);
  const width = image.naturalWidth * baseScale * zoom;
  const height = image.naturalHeight * baseScale * zoom;
  const context = targetCanvas.getContext("2d");
  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  context.fillStyle = "#f5f5f2";
  context.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  context.drawImage(
    image,
    ((AVATAR_CROP_SIZE - width) / 2 + offsetX) * ratio,
    ((AVATAR_CROP_SIZE - height) / 2 + offsetY) * ratio,
    width * ratio,
    height * ratio,
  );
}

function clampAvatarCrop() {
  if (!avatarCropSession) return;
  const { image, zoom } = avatarCropSession;
  const scale = Math.max(AVATAR_CROP_SIZE / image.naturalWidth, AVATAR_CROP_SIZE / image.naturalHeight) * zoom;
  const maxX = Math.max(0, (image.naturalWidth * scale - AVATAR_CROP_SIZE) / 2);
  const maxY = Math.max(0, (image.naturalHeight * scale - AVATAR_CROP_SIZE) / 2);
  avatarCropSession.offsetX = Math.max(-maxX, Math.min(maxX, avatarCropSession.offsetX));
  avatarCropSession.offsetY = Math.max(-maxY, Math.min(maxY, avatarCropSession.offsetY));
}

function beginAvatarCropDrag(event) {
  if (!avatarCropSession) return;
  event.preventDefault();
  els.avatarCropCanvas.setPointerCapture?.(event.pointerId);
  avatarCropSession.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  els.avatarCropCanvas.classList.add("dragging");
}

function moveAvatarCropDrag(event) {
  const drag = avatarCropSession?.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const rect = els.avatarCropCanvas.getBoundingClientRect();
  const factor = AVATAR_CROP_SIZE / Math.max(1, rect.width);
  avatarCropSession.offsetX += (event.clientX - drag.x) * factor;
  avatarCropSession.offsetY += (event.clientY - drag.y) * factor;
  drag.x = event.clientX;
  drag.y = event.clientY;
  clampAvatarCrop();
  renderAvatarCrop();
}

function endAvatarCropDrag(event) {
  const drag = avatarCropSession?.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  avatarCropSession.drag = null;
  els.avatarCropCanvas.classList.remove("dragging");
}

function finishAvatarCrop(accepted) {
  const session = avatarCropSession;
  if (!session) return;
  let result = null;
  if (accepted) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    renderAvatarCrop(canvas);
    result = { name: `${state.avatarTarget || "avatar"}.jpg`, mimeType: "image/jpeg", dataUrl: canvas.toDataURL("image/jpeg", 0.9) };
  }
  avatarCropSession = null;
  if (els.avatarCropDialog) els.avatarCropDialog.hidden = true;
  els.avatarCropCanvas?.classList.remove("dragging");
  session.resolve(result);
}

function openChatInfo() {
  if (!els.chatInfoPanel || !els.chatInfoOverlay) return;
  closeSidebar();
  closeMemoryPanel();
  closeHistorySearch(false);
  closeAvatarPanel();
  renderChatInfo();
  els.chatBackgroundStatus.textContent = "";
  els.chatInfoPanel.hidden = false;
  els.chatInfoOverlay.hidden = false;
  els.chatInfoClose?.focus();
}

function closeChatInfo() {
  if (els.chatInfoPanel) els.chatInfoPanel.hidden = true;
  if (els.chatInfoOverlay) els.chatInfoOverlay.hidden = true;
}

function renderChatInfo() {
  if (!els.chatInfoPanel) return;
  const chat = state.activeChat;
  const members = chatInfoMembers(chat);
  const isGroup = chat === "group";
  els.chatInfoTitle.textContent = isGroup ? `聊天信息 (${members.length})` : "聊天信息";
  els.chatInfoMembersSection.hidden = !isGroup;
  els.chatInfoNameSection.hidden = !isGroup;
  els.chatInfoMemberCount.textContent = `${members.length} 位`;
  els.chatInfoNameLabel.textContent = isGroup ? "群聊名称" : "聊天对象";
  els.chatInfoName.textContent = activeChatName(chat);
  els.chatInfoMemoryCount.textContent = `${memoriesForChat(chat).length} 条`;
  els.relayControl.hidden = !isGroup;
  els.kimiSettings.hidden = !["kimi", "glm"].includes(chat);
  els.chatInfoMembers.replaceChildren(...members.map((member) => {
    const item = document.createElement("div");
    item.className = "chat-info-member";
    const avatar = document.createElement("span");
    avatar.className = "chat-info-member-avatar";
    applyAvatarElement(avatar, member.id);
    const name = document.createElement("strong");
    name.textContent = member.name;
    const status = document.createElement("small");
    status.textContent = member.available ? (member.id === "okra" ? "我" : "在线") : "暂未连接";
    item.classList.toggle("offline", !member.available);
    item.append(avatar, name, status);
    return item;
  }));
  const backgroundUrl = state.chatBackgrounds[chat] || "";
  els.chatInfoBackgroundPreview.dataset.chat = chat;
  els.chatInfoBackgroundPreview.classList.toggle("custom", Boolean(backgroundUrl));
  els.chatInfoBackgroundPreview.style.backgroundImage = backgroundUrl ? `url("${imageVariantUrl(backgroundUrl, 320)}")` : "";
  els.chatInfoBackgroundReset.hidden = !backgroundUrl;
}

function chatInfoMembers(chat) {
  if (chat !== "group") {
    const id = chat === "glm" ? "glm" : chat;
    const provider = state.providers.find((item) => actorIdForProvider(item.id) === id);
    return [
      { id: "okra", name: "Okra", available: true },
      { id, name: activeChatName(chat), available: id === "gen" ? state.genEnabled : Boolean(provider?.available) },
    ];
  }
  const members = [{ id: "okra", name: "Okra", available: true }];
  const seen = new Set(["okra"]);
  for (const provider of state.providers) {
    const id = actorIdForProvider(provider.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    members.push({ id, name: id === "glm" ? "Shin" : provider.label || activeChatName(id), available: Boolean(provider.available) });
  }
  return members;
}

function actorIdForProvider(providerId) {
  if (["openai", "codex-cli"].includes(providerId)) return "gen";
  if (providerId === "kimi") return "kimi";
  if (providerId === "glm") return "glm";
  if (["anthropic", "claude-code"].includes(providerId)) return "k";
  return "";
}

function activeChatName(chat = state.activeChat) {
  return ({ group: "客厅", gen: "Gen", kimi: "Kimi", glm: "Shin", k: "K" })[chat] || chat;
}

function applyChatBackground() {
  const url = state.chatBackgrounds[state.activeChat] || "";
  els.chat.classList.toggle("has-chat-background", Boolean(url));
  els.chat.style.backgroundImage = url ? `url("${imageVariantUrl(url, 1200)}")` : "";
}

async function updateChatBackground(file) {
  if (els.chatBackgroundInput) els.chatBackgroundInput.value = "";
  if (!file) return;
  const channel = state.activeChat;
  const previous = state.chatBackgrounds[channel] || "";
  els.chatInfoBackground.disabled = true;
  els.chatBackgroundStatus.textContent = "正在处理背景……";
  try {
    const image = await prepareChatBackground(file);
    if (state.activeChat === channel) {
      els.chat.classList.add("has-chat-background");
      els.chat.style.backgroundImage = `url("${image.dataUrl}")`;
    }
    const response = await apiFetch(`/api/chat-backgrounds/${encodeURIComponent(channel)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "聊天背景上传失败");
    state.chatBackgrounds[channel] = payload.background.url;
    persistUiState();
    if (state.activeChat === channel) applyChatBackground();
    renderChatInfo();
    els.chatBackgroundStatus.textContent = "当前聊天背景已更新";
  } catch (error) {
    if (state.activeChat === channel) {
      els.chat.classList.toggle("has-chat-background", Boolean(previous));
      els.chat.style.backgroundImage = previous ? `url("${previous}")` : "";
    }
    els.chatBackgroundStatus.textContent = error.message || "聊天背景上传失败";
  } finally {
    els.chatInfoBackground.disabled = false;
  }
}

async function resetChatBackground() {
  const channel = state.activeChat;
  els.chatInfoBackgroundReset.disabled = true;
  els.chatBackgroundStatus.textContent = "正在恢复默认背景……";
  try {
    const response = await apiFetch(`/api/chat-backgrounds/${encodeURIComponent(channel)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("恢复默认背景失败");
    delete state.chatBackgrounds[channel];
    persistUiState();
    applyChatBackground();
    renderChatInfo();
    els.chatBackgroundStatus.textContent = "已恢复默认背景";
  } catch (error) {
    els.chatBackgroundStatus.textContent = error.message || "恢复默认背景失败";
  } finally {
    els.chatInfoBackgroundReset.disabled = false;
  }
}

async function prepareChatBackground(file) {
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) throw new Error("请选择 PNG、JPEG 或 WebP 图片");
  if (file.size > 25_000_000) throw new Error("原图不能超过 25 MB");
  const source = await readFileAsDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("无法读取这张背景图片"));
    element.src = source;
  });
  const maxDimension = 2400;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  let dataUrl = canvas.toDataURL("image/jpeg", 0.86);
  if (dataUrl.length > 7_500_000) dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  if (dataUrl.length > 7_500_000) throw new Error("处理后的背景图片仍然太大");
  return { name: "chat-background.jpg", mimeType: "image/jpeg", dataUrl };
}

function openHistorySearch() {
  if (!els.historySearchPanel || !els.historySearchOverlay) return;
  const returnToInfo = Boolean(els.chatInfoPanel && !els.chatInfoPanel.hidden);
  state.searchReturnToInfo = returnToInfo;
  closeSidebar();
  closeMemoryPanel();
  closeAvatarPanel();
  els.historySearchPanel.hidden = false;
  els.historySearchOverlay.hidden = false;
  els.historySearchChannel.textContent = activeChatName();
  els.historySearchInput.value = "";
  state.historySearchMember = "";
  renderHistoryMemberFilters();
  els.historySearchCount.textContent = "";
  const empty = document.createElement("p");
  empty.className = "history-search-empty";
  empty.textContent = `只查找“${activeChatName()}”里的聊天记录。`;
  els.historySearchResults.replaceChildren(empty);
  setTimeout(() => els.historySearchInput.focus(), 0);
}

function closeHistorySearch(restoreInfo = true) {
  const shouldRestoreInfo = restoreInfo && state.searchReturnToInfo;
  state.searchReturnToInfo = false;
  if (els.historySearchPanel) els.historySearchPanel.hidden = true;
  if (els.historySearchOverlay) els.historySearchOverlay.hidden = true;
  if (shouldRestoreInfo && els.chatInfoPanel && els.chatInfoOverlay) {
    renderChatInfo();
    els.chatInfoPanel.hidden = false;
    els.chatInfoOverlay.hidden = false;
    els.chatInfoSearch?.focus();
  }
}

async function searchHistory(event) {
  event?.preventDefault?.();
  const query = els.historySearchInput.value.trim();
  const member = state.historySearchMember;
  if (!query && !member) {
    els.historySearchCount.textContent = "";
    const empty = document.createElement("p");
    empty.className = "history-search-empty";
    empty.textContent = `输入关键词，或选择一位${state.activeChat === "group" ? "群成员" : "成员"}。`;
    els.historySearchResults.replaceChildren(empty);
    return;
  }
  const submit = els.historySearchForm.querySelector("button[type=submit]");
  submit.disabled = true;
  els.historySearchCount.textContent = "正在找……";
  try {
    const parameters = new URLSearchParams({ limit: "50", channel: state.activeChat });
    if (query) parameters.set("query", query);
    if (member) parameters.set("member", member);
    const response = await apiFetch(`/api/history?${parameters}`);
    if (!response.ok) throw new Error("搜索聊天记录失败");
    const payload = await response.json();
    const entries = (Array.isArray(payload.entries) ? payload.entries : []).filter((message) => !isMessageHidden(message));
    els.historySearchCount.textContent = entries.length ? `${entries.length} 条结果` : "没有找到";
    renderHistorySearchResults(entries);
  } catch (error) {
    els.historySearchCount.textContent = "搜索失败";
    const empty = document.createElement("p");
    empty.className = "history-search-empty";
    empty.textContent = error.message || "稍后再试";
    els.historySearchResults.replaceChildren(empty);
  } finally {
    submit.disabled = false;
  }
}

function renderHistoryMemberFilters() {
  if (!els.historySearchMembers) return;
  els.historySearchMembers.replaceChildren(...chatInfoMembers(state.activeChat).map((member) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.member = member.id;
    button.setAttribute("aria-pressed", String(state.historySearchMember === member.id));
    const avatar = document.createElement("span");
    avatar.className = "history-search-member-avatar";
    applyAvatarElement(avatar, member.id);
    const label = document.createElement("span");
    label.textContent = member.name;
    button.append(avatar, label);
    return button;
  }));
}

function renderHistorySearchResults(entries) {
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "history-search-empty";
    empty.textContent = "没有搜到这句话。";
    els.historySearchResults.replaceChildren(empty);
    return;
  }
  els.historySearchResults.replaceChildren(...entries.map((message) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-search-result";
    const meta = document.createElement("span");
    meta.className = "history-search-result-meta";
    const author = document.createElement("span");
    const channel = historyChannelName(messageChannel(message));
    author.textContent = `${message.role === "user" ? "Okra" : displayAuthor(message)} · ${channel}`;
    const time = document.createElement("time");
    time.textContent = formatHistorySearchTime(message.createdAt);
    meta.append(author, time);
    const content = document.createElement("span");
    content.className = "history-search-result-content";
    content.textContent = displayMessageContent(message) || (message.attachments?.length ? "[图片]" : "[无正文]");
    button.append(meta, content);
    button.addEventListener("click", () => void openArchivedMessage(message));
    return button;
  }));
}

async function openArchivedMessage(message) {
  try {
    const response = await apiFetch(`/api/history?around=${encodeURIComponent(message.id)}&radius=24`);
    if (!response.ok) throw new Error("无法打开这条记录");
    const payload = await response.json();
    mergeArchivedMessages(payload.entries || []);
    closeHistorySearch(false);
    setActiveChat(messageChannel(message));
    requestAnimationFrame(() => {
      const target = els.messages.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
      if (!target) return;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.classList.add("history-target");
      setTimeout(() => target.classList.remove("history-target"), 2_000);
    });
  } catch (error) {
    els.historySearchCount.textContent = error.message || "打开失败";
  }
}

async function loadEarlierMessages() {
  const channel = state.activeChat;
  const visible = state.history.filter((message) => messageChannel(message) === channel)
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  const parameters = new URLSearchParams({ channel, limit: "60" });
  if (visible[0]?.createdAt) parameters.set("before", visible[0].createdAt);
  els.loadEarlier.disabled = true;
  els.loadEarlier.textContent = "正在加载……";
  const previousHeight = els.chat.scrollHeight;
  const previousTop = els.chat.scrollTop;
  try {
    const response = await apiFetch(`/api/history?${parameters}`);
    if (!response.ok) throw new Error("旧记录加载失败");
    const payload = await response.json();
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (!entries.length || !payload.nextCursor) state.historyExhausted.add(channel);
    mergeArchivedMessages(entries);
    renderHistory();
    els.chat.scrollTop = previousTop + Math.max(0, els.chat.scrollHeight - previousHeight);
  } catch (error) {
    appendSystem(error.message || "旧记录加载失败");
  } finally {
    els.loadEarlier.disabled = false;
    els.loadEarlier.textContent = "查看更早记录";
    updateEarlierButton();
  }
}

function mergeArchivedMessages(entries) {
  const known = new Map(state.history.map((message) => [message.id, message]));
  for (const message of entries) {
    if (message?.id && !known.has(message.id)) {
      state.history.push(message);
      known.set(message.id, message);
    }
  }
  state.history.sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  persistHistory();
}

function updateEarlierButton() {
  if (!els.loadEarlier) return;
  els.loadEarlier.hidden = state.historyExhausted.has(state.activeChat);
}

function historyChannelName(channel) {
  return ({ group: "客厅", gen: "Gen 私聊", kimi: "Kimi 私聊", glm: "Shin 私聊" })[channel] || channel;
}

function formatHistorySearchTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function openSidebar() {
  openChatHome();
}

function openChatHome() {
  closeMessageActions();
  els.input.blur();
  clearLocalizedKeyboardInset();
  if (els.shell.classList.contains("conversation-open")) markChatRead(state.activeChat, false);
  closeChatInfo();
  closeHistorySearch(false);
  closeMemoryPanel();
  closeAvatarPanel();
  els.shell.classList.remove("conversation-open", "sidebar-open");
  els.sidebarOverlay.hidden = true;
  renderConversationList();
}

function pushConversationHistory(chat) {
  const nextState = { ...(history.state || {}), livingRoomSection: "chat", livingRoomView: "conversation", chat };
  if (history.state?.livingRoomView === "conversation") history.replaceState(nextState, "", location.href);
  else history.pushState(nextState, "", location.href);
}

function returnToChatHome() {
  if (els.shell.classList.contains("conversation-open") && history.state?.livingRoomView === "conversation") {
    history.back();
    return;
  }
  openChatHome();
}

function handleChatPopState() {
  if (location.pathname !== "/") return;
  closeMessageActions();
  if (els.shell.classList.contains("conversation-open")) openChatHome();
}

function replaceSectionFromBottomNav(event) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
  event.preventDefault();
  closeMessageActions();
  location.replace(event.currentTarget.href);
}

function installChatEdgeSwipe() {
  let gesture = null;
  const reset = () => { gesture = null; };
  document.addEventListener("touchstart", (event) => {
    if (memberProfile.isOpen() || !els.shell.classList.contains("conversation-open") || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (touch.clientX > 28) return;
    gesture = { x: touch.clientX, y: touch.clientY, dx: 0, dy: 0 };
    event.preventDefault();
  }, { passive: false });
  document.addEventListener("touchmove", (event) => {
    if (!gesture || event.touches.length !== 1) return;
    const touch = event.touches[0];
    gesture.dx = touch.clientX - gesture.x;
    gesture.dy = touch.clientY - gesture.y;
    if (gesture.dx > 0) event.preventDefault();
  }, { passive: false });
  document.addEventListener("touchend", () => {
    if (gesture && gesture.dx >= 62 && Math.abs(gesture.dy) <= 72) returnToChatHome();
    reset();
  }, { passive: true });
  document.addEventListener("touchcancel", reset, { passive: true });
}

function openAvatarPanel() {
  if (!els.avatarPanel || !els.avatarOverlay) return;
  closeSidebar();
  closeChatInfo();
  closeMemoryPanel();
  els.avatarStatus.textContent = "";
  renderAvatars();
  els.avatarPanel.hidden = false;
  els.avatarOverlay.hidden = false;
}

function closeAvatarPanel() {
  if (els.avatarPanel) els.avatarPanel.hidden = true;
  if (els.avatarOverlay) els.avatarOverlay.hidden = true;
}

function closeSidebar() {
  els.shell.classList.remove("sidebar-open");
  els.sidebarOverlay.hidden = true;
}

function openMemoryPanel() {
  closeSidebar();
  closeChatInfo();
  renderMemories();
  els.memoryPanel.hidden = false;
  els.memoryOverlay.hidden = false;
  setTimeout(() => els.memoryInput.focus(), 0);
}

function closeMemoryPanel() {
  els.memoryPanel.hidden = true;
  els.memoryOverlay.hidden = true;
}

let historyPersistTimer = 0;

function persistHistory() {
  if (historyPersistTimer) return;
  historyPersistTimer = setTimeout(flushPersistHistory, 250);
}

function flushPersistHistory() {
  if (historyPersistTimer) clearTimeout(historyPersistTimer);
  historyPersistTimer = 0;
  const safeHistory = state.history.slice(-200).map(({ pending, reasoning, toolCalls, ...message }) => ({
    ...message,
    attachments: (message.attachments || []).filter((attachment) => !String(attachment.url || "").startsWith("data:")),
  }));
  localStorage.setItem("roundtable.history", JSON.stringify(safeHistory));
}

window.addEventListener("pagehide", flushPersistHistory);

function readStoredHistory() {
  try {
    const value = JSON.parse(localStorage.getItem("roundtable.history") || "[]");
    return Array.isArray(value) ? value.slice(-300) : [];
  } catch { return []; }
}

function readHiddenMessageIds() {
  try {
    const value = JSON.parse(localStorage.getItem("roundtable.hiddenMessageIds.v1") || "[]");
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === "string").slice(-500) : []);
  } catch { return new Set(); }
}

function persistHiddenMessageIds() {
  localStorage.setItem("roundtable.hiddenMessageIds.v1", JSON.stringify([...state.hiddenMessageIds].slice(-500)));
}

function isMessageHidden(message) {
  return Boolean(message?.id && state.hiddenMessageIds.has(message.id));
}

function hideMessageLocally(message) {
  if (!message?.id || !state.history.some((item) => item.id === message.id)) return;
  state.hiddenMessageIds.delete(message.id);
  state.hiddenMessageIds.add(message.id);
  while (state.hiddenMessageIds.size > 500) state.hiddenMessageIds.delete(state.hiddenMessageIds.values().next().value);
  for (const channel of Object.keys(state.composerQuotes)) {
    if (state.composerQuotes[channel]?.messageId === message.id) state.composerQuotes[channel] = null;
  }
  persistHiddenMessageIds();
  renderComposerQuote();
  renderHistory();
  renderConversationList();
  showTransientToast("已从当前设备隐藏");
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

function displayMessageContent(message) {
  let text = String(message?.content || "");
  if (!["kimi", "glm"].includes(message?.providerId)) return text;
  const metadataPrefixes = [
    /^\s*(?:\*\*|__)?(?:Kimi|Shin|GLM)(?:\*\*|__)?\s*[：:]\s*(?:\*\*|__)?\s*/iu,
    /^\s*[【[](?:私聊|群聊|Kimi\s*私聊|LIVING ROOM(?:\s*群聊)?)[】\]]\s*/iu,
    /^\s*\[发送时间：[^\]\r\n]{1,160}\]\s*/u,
    /^\s*\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?（Asia\/Shanghai，UTC\+08:00）\]\s*/u,
    /^\s*(?:当前时间|发送时间)\s*[：:]\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?（Asia\/Shanghai，UTC\+08:00）[。；]?\s*/u,
  ];
  for (let pass = 0; pass < metadataPrefixes.length; pass += 1) {
    for (const prefix of metadataPrefixes) text = text.replace(prefix, "");
  }
  text = text.trimStart();
  if (!message.pending) return text;
  const partial = text.trimStart();
  if (/^(?:\*\*|__)?K(?:i(?:m(?:i)?)?)?(?:\*\*|__)?\s*[：:]?\s*(?:\*\*|__)?\s*$/iu.test(partial)) return "";
  if (/^(?:\*\*|__)?G(?:L(?:M)?)?(?:\*\*|__)?\s*[：:]?\s*(?:\*\*|__)?\s*$/iu.test(partial)) return "";
  const starters = ["[发送时间：", "当前时间：", "发送时间：", "[私聊]", "【私聊】", "[群聊]", "【群聊】"];
  if (starters.some((starter) => starter.startsWith(partial) || (partial.startsWith(starter) && !partial.includes("]") && starter.startsWith("[")))) return "";
  return text;
}

function scrollToBottom(smooth = true) {
  requestAnimationFrame(() => els.chat.scrollTo({ top: els.chat.scrollHeight, behavior: smooth ? "smooth" : "auto" }));
}

function isNearBottom(threshold = 96) {
  return els.chat.scrollHeight - els.chat.scrollTop - els.chat.clientHeight <= threshold;
}

function normalizeClientQuote(value) {
  const text = [...String(value?.text || "").replace(/\s+/gu, " ").trim()].slice(0, 2_000).join("");
  if (!text) return null;
  const rawAuthor = String(value?.author || "").trim();
  const author = !rawAuthor || ["用户", "你", "okra"].includes(rawAuthor.toLowerCase())
    ? "Okra"
    : ["GLM", "glm", "智谱"].includes(rawAuthor) ? "Shin"
      : ["GPT", "ChatGPT", "G老师"].includes(rawAuthor) ? "Gen" : rawAuthor.slice(0, 80);
  return { messageId: String(value?.messageId || "").slice(0, 120), author, text };
}

function openMessageActions(target) {
  const messageId = target?.closest(".message")?.dataset?.messageId;
  const message = state.history.find((item) => item.id === messageId)
    || Object.values(state.drafts).find((item) => item?.id === messageId);
  if (!message || !displayMessageContent(message)) return;
  clearBrowserSelection();
  messageActionTarget = target;
  messageActionMessage = message;
  els.messageActionOverlay.hidden = false;
  els.messageActionDelete.disabled = !state.history.some((item) => item.id === message.id);
  els.messageActionMenu.hidden = false;
  if (!positionMessageActionMenu(target)) {
    closeMessageActions();
    return;
  }
  trackMessageActionPosition();
  navigator.vibrate?.(18);
}

function clearBrowserSelection() {
  const selection = window.getSelection?.();
  if (selection && selection.rangeCount) selection.removeAllRanges();
}

function positionMessageActionMenu(target) {
  if (!target?.isConnected) return false;
  const targetRect = target.getBoundingClientRect();
  const menu = els.messageActionMenu;
  const menuRect = menu.getBoundingClientRect();
  const chatRect = els.chat.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const edge = 10;
  const gap = 11;
  const visibleTop = Math.max(edge, chatRect.top + 8);
  const visibleBottom = Math.min(viewportHeight - edge, chatRect.bottom - 8);
  if (targetRect.bottom <= visibleTop || targetRect.top >= visibleBottom) return false;
  const anchorX = targetRect.left + targetRect.width / 2;
  const centeredLeft = anchorX - menuRect.width / 2;
  const left = Math.max(edge, Math.min(centeredLeft, viewportWidth - menuRect.width - edge));
  const above = targetRect.top - menuRect.height - gap;
  const below = targetRect.bottom + gap;
  const fitsAbove = above >= visibleTop;
  const fitsBelow = below + menuRect.height <= visibleBottom;
  const placement = fitsAbove ? "above" : fitsBelow ? "below" : "center";
  const visibleBubbleTop = Math.max(targetRect.top, visibleTop);
  const visibleBubbleBottom = Math.min(targetRect.bottom, visibleBottom);
  const top = placement === "above"
    ? above
    : placement === "below"
      ? below
      : Math.max(visibleTop, Math.min((visibleBubbleTop + visibleBubbleBottom - menuRect.height) / 2, visibleBottom - menuRect.height));
  const arrow = Math.max(18, Math.min(anchorX - left, menuRect.width - 18));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.setProperty("--menu-arrow-x", `${Math.round(arrow)}px`);
  menu.dataset.placement = placement;
  return true;
}

function trackMessageActionPosition() {
  cancelAnimationFrame(messageActionPositionFrame);
  const update = () => {
    if (els.messageActionMenu.hidden || !messageActionTarget) return;
    if (!positionMessageActionMenu(messageActionTarget)) {
      closeMessageActions();
      return;
    }
    messageActionPositionFrame = requestAnimationFrame(update);
  };
  messageActionPositionFrame = requestAnimationFrame(update);
}

function closeMessageActions() {
  cancelAnimationFrame(messageActionPositionFrame);
  messageActionPositionFrame = 0;
  els.messageActionOverlay.hidden = true;
  els.messageActionMenu.hidden = true;
  messageActionTarget = null;
  messageActionMessage = null;
}

function selectMessageQuote(message) {
  const quote = normalizeClientQuote({
    messageId: message.id,
    author: message.role === "user" ? "Okra" : displayAuthor(message),
    text: displayMessageContent(message),
  });
  if (!quote) return;
  state.composerQuotes[state.activeChat] = quote;
  renderComposerQuote();
  els.input.focus();
}

function clearActiveQuote() {
  state.composerQuotes[state.activeChat] = null;
  renderComposerQuote();
}

function renderComposerQuote() {
  const quote = normalizeClientQuote(state.composerQuotes[state.activeChat]);
  els.quotePreview.hidden = !quote;
  if (!quote) return;
  els.quotePreviewAuthor.textContent = `引用 ${quote.author}`;
  els.quotePreviewText.textContent = quote.text;
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
  showTransientToast(copied ? "已复制" : "复制失败");
  navigator.vibrate?.(18);
}

function showTransientToast(text) {
  els.copyToast.textContent = text;
  els.copyToast.hidden = false;
  clearTimeout(showTransientToast.timer);
  showTransientToast.timer = setTimeout(() => { els.copyToast.hidden = true; }, 1100);
}

function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = sessionStorage.getItem("roundtable.accessToken");
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

function isTransientConnectionError(error) {
  const message = String(error?.message || error || "");
  return ["TypeError", "NetworkError", "AbortError"].includes(error?.name)
    || /load failed|failed to fetch|network(?:error)?|fetch failed|connection.*(?:closed|lost|reset)/iu.test(message);
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

async function saveGlmKeyToServer(apiKey) {
  const response = await apiFetch("/api/glm/key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (response.ok) return true;
  const payload = await response.json().catch(() => ({}));
  appendSystem(payload.error || "GLM API Key 保存失败");
  return false;
}

installLocalizedKeyboardInset();
restoreComposerDraft(state.activeChat);
renderAvatars();
hydrateCachedHistory();
void refreshUiState();
await initialize();
startServerMessageSync();
