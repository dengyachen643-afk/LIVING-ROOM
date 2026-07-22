import { createMemberProfile } from "./member-profile.js?v=20260722-1";

const els = {
  feed: document.querySelector("#feed"),
  empty: document.querySelector("#empty-state"),
  loadMore: document.querySelector("#load-more"),
  connection: document.querySelector("#connection-note"),
  newPost: document.querySelector("#new-post-button"),
  cover: document.querySelector(".moments-cover"),
  changeCover: document.querySelector("#change-cover-button"),
  coverImageInput: document.querySelector("#cover-image-input"),
  postDialog: document.querySelector("#post-dialog"),
  closePost: document.querySelector("#close-post"),
  publishPost: document.querySelector("#publish-post"),
  postContent: document.querySelector("#post-content"),
  postImages: document.querySelector("#post-images"),
  addImages: document.querySelector("#add-images"),
  previews: document.querySelector("#post-previews"),
  postStatus: document.querySelector("#post-status"),
  commentDialog: document.querySelector("#comment-dialog"),
  commentForm: document.querySelector("#comment-form"),
  closeComment: document.querySelector("#close-comment"),
  commentTitle: document.querySelector("#comment-title"),
  commentContent: document.querySelector("#comment-content"),
  commentStatus: document.querySelector("#comment-status"),
  lightbox: document.querySelector("#lightbox"),
  lightboxImage: document.querySelector("#lightbox-image"),
  closeLightbox: document.querySelector("#close-lightbox"),
  toast: document.querySelector("#toast"),
  chatUnread: document.querySelector("#bottom-chat-unread"),
};

const names = { okra: "Okra", gen: "Gen", kimi: "Kimi", shin: "Shin", glm: "Shin", k: "K" };
const initials = { okra: "O", gen: "G", kimi: "Ki", shin: "S", glm: "S", k: "K" };
const cachedUiState = readCachedUiState();
const state = {
  moments: [],
  nextCursor: "",
  syncCursor: "",
  avatars: cachedUiState.avatars,
  signatures: cachedUiState.signatures,
  pendingImages: [],
  commentTarget: null,
  polling: false,
  coverUrl: "",
  seenAt: readSeenAt(),
  hasSeenState: localStorage.getItem("roundtable.seenAt") !== null,
};

const memberProfile = createMemberProfile({
  getAvatarUrl: (id) => state.avatars[id] || "",
  getSignature: (id) => state.signatures[id] || "",
  canMessage: (id) => ["gen", "kimi", "glm"].includes(id),
  onMessage: (id) => {
    localStorage.setItem("roundtable.activeChat", id);
    location.replace(`/?chat=${encodeURIComponent(id)}`);
  },
  onSaveSignature: saveProfileSignature,
  onUploadAvatar: uploadMemberAvatar,
  onResetAvatar: resetMemberAvatar,
});

const queryToken = new URLSearchParams(location.search).get("access_token") || "";
if (queryToken) {
  sessionStorage.setItem("roundtable.accessToken", queryToken);
  history.replaceState({}, "", location.pathname);
}

document.querySelector('.bottom-nav-item.active')?.addEventListener("click", (event) => event.preventDefault());
document.querySelector('.bottom-nav-item:not(.active)')?.addEventListener("click", replaceSectionFromBottomNav);
blockMomentEdgeSwipe();

els.newPost.addEventListener("click", openPostDialog);
els.changeCover.addEventListener("click", () => els.coverImageInput.click());
els.coverImageInput.addEventListener("change", () => void updateCover([...els.coverImageInput.files][0]));
els.empty.querySelector("button").addEventListener("click", openPostDialog);
els.closePost.addEventListener("click", closePostDialog);
els.postDialog.addEventListener("click", (event) => { if (event.target === els.postDialog) closePostDialog(); });
els.addImages.addEventListener("click", () => els.postImages.click());
els.postImages.addEventListener("change", () => addImages([...els.postImages.files]));
els.publishPost.addEventListener("click", publishPost);
els.closeComment.addEventListener("click", closeCommentDialog);
els.commentDialog.addEventListener("click", (event) => { if (event.target === els.commentDialog) closeCommentDialog(); });
els.commentForm.addEventListener("submit", submitComment);
els.commentContent.addEventListener("input", resizeCommentInput);
els.loadMore.addEventListener("click", loadOlder);
els.closeLightbox.addEventListener("click", closeLightbox);
els.lightbox.addEventListener("click", (event) => { if (event.target === els.lightbox) closeLightbox(); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!els.lightbox.hidden) closeLightbox();
  else if (!els.commentDialog.hidden) closeCommentDialog();
  else if (!els.postDialog.hidden) closePostDialog();
});

function replaceSectionFromBottomNav(event) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
  event.preventDefault();
  location.replace(event.currentTarget.href);
}

function blockMomentEdgeSwipe() {
  let blocking = false;
  document.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) return;
    blocking = event.touches[0].clientX <= 28;
    if (blocking) event.preventDefault();
  }, { passive: false });
  document.addEventListener("touchmove", (event) => {
    if (blocking) event.preventDefault();
  }, { passive: false });
  document.addEventListener("touchend", () => { blocking = false; }, { passive: true });
  document.addEventListener("touchcancel", () => { blocking = false; }, { passive: true });
}

applyAvatars();
await initialize();
setInterval(() => void syncMoments(), 15_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) void syncMoments(); });

async function initialize() {
  try {
    const [snapshotResponse, momentsResponse] = await Promise.all([apiFetch("/api/ui-state"), apiFetch("/api/moments?limit=20")]);
    if (!snapshotResponse.ok) throw await responseError(snapshotResponse);
    if (!momentsResponse.ok) throw await responseError(momentsResponse);
    const [snapshot, result] = await Promise.all([snapshotResponse.json(), momentsResponse.json()]);
    state.avatars = snapshot.avatars || {};
    state.signatures = snapshot.signatures || {};
    persistUiState();
    initializeSeenState(snapshot.messages || []);
    renderChatUnread(snapshot.messages || []);
    state.moments = result.entries || [];
    state.nextCursor = result.nextCursor || "";
    state.syncCursor = result.syncCursor || result.serverTime || new Date().toISOString();
    state.coverUrl = result.coverUrl || "";
    applyAvatars();
    applyCover(state.coverUrl);
    renderFeed();
  } catch (error) {
    showConnection(error.message || "朋友圈暂时没有连上");
  }
}

async function syncMoments() {
  if (state.polling) return;
  state.polling = true;
  try {
    const since = state.syncCursor || new Date(0).toISOString();
    const [response, chatStateResponse] = await Promise.all([
      apiFetch(`/api/moments?since=${encodeURIComponent(since)}&limit=50`),
      apiFetch("/api/ui-state"),
    ]);
    if (!response.ok) throw await responseError(response);
    const result = await response.json();
    if (chatStateResponse.ok) {
      const chatState = await chatStateResponse.json();
      renderChatUnread(chatState.messages || []);
      const avatarsChanged = JSON.stringify(chatState.avatars || {}) !== JSON.stringify(state.avatars);
      const signaturesChanged = JSON.stringify(chatState.signatures || {}) !== JSON.stringify(state.signatures);
      if (avatarsChanged || signaturesChanged) {
        state.avatars = chatState.avatars || {};
        state.signatures = chatState.signatures || {};
        persistUiState();
        applyAvatars();
        renderFeed();
      }
    }
    mergeMoments(result.entries || []);
    if ((result.coverUrl || "") !== state.coverUrl) {
      state.coverUrl = result.coverUrl || "";
      applyCover(state.coverUrl);
    }
    state.syncCursor = result.syncCursor || state.syncCursor;
    els.connection.hidden = true;
  } catch (error) {
    showConnection("连接刚刚断了一下，回来后会自动补齐。");
  } finally {
    state.polling = false;
  }
}

async function loadOlder() {
  if (!state.nextCursor) return;
  els.loadMore.disabled = true;
  try {
    const response = await apiFetch(`/api/moments?cursor=${encodeURIComponent(state.nextCursor)}&limit=20`);
    if (!response.ok) throw await responseError(response);
    const result = await response.json();
    mergeMoments(result.entries || []);
    state.nextCursor = result.nextCursor || "";
  } catch (error) {
    showToast(error.message || "加载失败");
  } finally {
    els.loadMore.disabled = false;
    renderFeed();
  }
}

function mergeMoments(entries) {
  if (!entries.length) return;
  const merged = new Map(state.moments.map((item) => [item.id, item]));
  entries.forEach((item) => merged.set(item.id, item));
  state.moments = [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  renderFeed();
}

function renderFeed() {
  const fragment = document.createDocumentFragment();
  state.moments.forEach((moment) => fragment.append(renderMoment(moment)));
  els.feed.replaceChildren(fragment);
  els.empty.hidden = state.moments.length > 0;
  els.loadMore.hidden = !state.nextCursor;
}

function renderMoment(moment) {
  const article = element("article", "moment");
  article.dataset.momentId = moment.id;
  article.append(createAvatar(moment.authorId));
  const main = element("div", "moment-main");
  main.append(textElement("strong", "author", displayName(moment.authorId)));
  if (moment.content) main.append(textElement("p", "moment-content", moment.content));
  if (moment.media?.length) main.append(renderMedia(moment.media, moment.updatedAt || moment.createdAt));

  const footer = element("div", "moment-footer");
  const timeWrap = element("span");
  timeWrap.append(textElement("time", "moment-time", formatTime(moment.createdAt)));
  if (moment.pendingUpload) timeWrap.append(textElement("span", "moment-publish-state", "正在发布…"));
  else if (moment.publishError) {
    const retry = textElement("button", "moment-publish-state failed", "发布失败 · 重试");
    retry.type = "button";
    retry.addEventListener("click", () => void sendPendingMoment(moment));
    timeWrap.append(retry);
  }
  footer.append(timeWrap);
  const controls = element("div", "moment-footer-controls");
  const menu = textElement("button", "moment-menu", "··");
  menu.type = "button";
  menu.disabled = Boolean(moment.pendingUpload || moment.publishError);
  menu.setAttribute("aria-label", "点赞或评论");
  const actions = element("div", "moment-actions");
  actions.hidden = true;
  const liked = (moment.likes || []).some((like) => like.actorId === "okra");
  const likeButton = textElement("button", "", liked ? "取消赞" : "♡ 赞");
  likeButton.type = "button";
  const commentButton = textElement("button", "", "评论");
  commentButton.type = "button";
  actions.append(likeButton, commentButton);
  controls.append(actions, menu);
  footer.append(controls);
  main.append(footer);
  menu.addEventListener("click", () => { actions.hidden = !actions.hidden; });
  likeButton.addEventListener("click", () => void toggleLike(moment, !liked));
  commentButton.addEventListener("click", () => openCommentDialog(moment));

  const social = renderSocial(moment);
  if (social) main.append(social);
  article.append(main);
  return article;
}

function renderMedia(media, version = "") {
  const grid = element("div", `media-grid ${media.length === 1 ? "one" : media.length === 2 ? "two" : ""}`);
  media.forEach((item) => {
    const button = element("button");
    button.type = "button";
    const image = document.createElement("img");
    image.src = versionedImageUrl(item.url, version, 720);
    image.alt = "朋友圈图片";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => retryMomentImage(image, item.url), { once: true });
    button.append(image);
    button.addEventListener("click", () => openLightbox(item.url));
    grid.append(button);
  });
  return grid;
}

function renderSocial(moment) {
  const likes = moment.likes || [];
  const comments = moment.comments || [];
  if (!likes.length && !comments.length) return null;
  const social = element("div", "social");
  if (likes.length) {
    const row = element("div", "likes");
    row.textContent = `♡ ${likes.map((item) => displayName(item.actorId)).join("、")}`;
    social.append(row);
  }
  if (comments.length) {
    const list = element("div", "comments");
    comments.forEach((comment) => {
      const row = element("p", "comment");
      const author = textElement("button", "", displayName(comment.authorId));
      author.type = "button";
      author.addEventListener("click", () => openCommentDialog(moment, comment));
      row.append(author);
      if (comment.replyToAuthorId) row.append(document.createTextNode(" 回复 "), textElement("span", "reply-name", displayName(comment.replyToAuthorId)));
      row.append(document.createTextNode(`：${comment.content}`));
      row.addEventListener("click", (event) => {
        if (event.target === row) openCommentDialog(moment, comment);
      });
      list.append(row);
    });
    social.append(list);
  }
  return social;
}

async function toggleLike(moment, liked) {
  try {
    const response = await apiFetch(`/api/moments/${encodeURIComponent(moment.id)}/like`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ liked }),
    });
    if (!response.ok) throw await responseError(response);
    const result = await response.json();
    mergeMoments([result.moment]);
  } catch (error) { showToast(error.message || "没有点上"); }
}

function openPostDialog() {
  els.postDialog.hidden = false;
  requestAnimationFrame(() => els.postContent.focus());
}

function closePostDialog() {
  if (els.publishPost.disabled) return;
  els.postDialog.hidden = true;
}

async function addImages(files) {
  const accepted = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  for (const file of files.slice(0, Math.max(0, 4 - state.pendingImages.length))) {
    if (!accepted.has(file.type) || file.size > 20_000_000) {
      els.postStatus.textContent = `${file.name} 不是支持的图片，或文件过大。`;
      continue;
    }
    els.postStatus.textContent = "正在处理图片……";
    try {
      const prepared = await prepareUploadImage(file, { maxDimension: 2048, quality: 0.86 });
      state.pendingImages.push({ id: crypto.randomUUID(), ...prepared });
      els.postStatus.textContent = "";
    } catch {
      els.postStatus.textContent = `${file.name} 无法读取，请换一张试试。`;
    }
  }
  els.postImages.value = "";
  renderPreviews();
}

function renderPreviews() {
  els.previews.replaceChildren(...state.pendingImages.map((item) => {
    const wrap = element("div", "post-preview");
    const image = document.createElement("img");
    image.src = item.dataUrl;
    image.alt = item.name;
    const remove = textElement("button", "", "×");
    remove.type = "button";
    remove.addEventListener("click", () => {
      state.pendingImages = state.pendingImages.filter((imageItem) => imageItem.id !== item.id);
      renderPreviews();
    });
    wrap.append(image, remove);
    return wrap;
  }));
}

function publishPost() {
  const content = els.postContent.value.trim();
  if (!content && !state.pendingImages.length) {
    els.postStatus.textContent = "至少留下一句话或一张图片。";
    return;
  }
  const id = crypto.randomUUID();
  const images = state.pendingImages.map(({ name, dataUrl }) => ({ name, dataUrl }));
  const now = new Date().toISOString();
  const optimistic = {
    id,
    authorId: "okra",
    content,
    media: images.map((image, index) => ({ id: `${id}-${index}`, url: image.dataUrl, mimeType: dataUrlMime(image.dataUrl) })),
    comments: [],
    likes: [],
    createdAt: now,
    updatedAt: now,
    pendingUpload: true,
    pendingPayload: { id, content, images },
  };
  state.moments.unshift(optimistic);
  renderFeed();
  els.postContent.value = "";
  state.pendingImages = [];
  renderPreviews();
  els.postStatus.textContent = "";
  els.postDialog.hidden = true;
  showToast("已经放上去了");
  requestAnimationFrame(() => setTimeout(() => void sendPendingMoment(optimistic), 0));
}

async function sendPendingMoment(moment) {
  const current = state.moments.find((item) => item.id === moment.id);
  if (!current?.pendingPayload) return;
  current.pendingUpload = true;
  current.publishError = "";
  renderFeed();
  try {
    const response = await apiFetch("/api/moments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(current.pendingPayload),
    });
    if (!response.ok) throw await responseError(response);
    const result = await response.json();
    mergeMoments([result.moment]);
    showToast("发出去了");
  } catch (error) {
    current.pendingUpload = false;
    current.publishError = error.message || "发表失败";
    renderFeed();
    showToast("没有发成功，可以点重试");
  }
}

function openCommentDialog(moment, replyTo = null) {
  state.commentTarget = { moment, replyTo };
  const targetName = replyTo ? displayName(replyTo.authorId) : displayName(moment.authorId);
  els.commentTitle.textContent = replyTo ? `回复 ${targetName}` : `评论 ${targetName}`;
  els.commentContent.placeholder = replyTo ? `回复 ${targetName}：` : "发表评论……";
  els.commentContent.setAttribute("aria-label", els.commentTitle.textContent);
  els.commentContent.value = "";
  resizeCommentInput();
  els.commentStatus.textContent = "";
  els.commentDialog.hidden = false;
  document.body.classList.add("commenting");
  syncCommentViewport();
  requestAnimationFrame(() => {
    els.commentDialog.classList.add("open");
    els.commentContent.focus({ preventScroll: true });
  });
}

function closeCommentDialog(force = false) {
  if (!force && els.commentForm.querySelector("button[type=submit]").disabled) return;
  els.commentDialog.classList.remove("open");
  document.body.classList.remove("commenting");
  els.commentContent.blur();
  state.commentTarget = null;
  setTimeout(() => {
    if (!els.commentDialog.classList.contains("open")) els.commentDialog.hidden = true;
  }, 190);
}

function resizeCommentInput() {
  els.commentContent.style.height = "auto";
  els.commentContent.style.height = `${Math.min(112, Math.max(40, els.commentContent.scrollHeight))}px`;
}

function syncCommentViewport() {
  const viewport = window.visualViewport;
  if (!viewport || els.commentDialog.hidden) return;
  els.commentDialog.style.top = `${viewport.offsetTop}px`;
  els.commentDialog.style.height = `${viewport.height}px`;
}

window.visualViewport?.addEventListener("resize", syncCommentViewport);
window.visualViewport?.addEventListener("scroll", syncCommentViewport);

async function submitComment(event) {
  event.preventDefault();
  const target = state.commentTarget;
  const content = els.commentContent.value.trim();
  if (!target || !content) return;
  const submit = els.commentForm.querySelector("button[type=submit]");
  submit.disabled = true;
  els.commentStatus.textContent = "正在发送……";
  try {
    const response = await apiFetch(`/api/moments/${encodeURIComponent(target.moment.id)}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, replyToCommentId: target.replyTo?.id || "" }),
    });
    if (!response.ok) throw await responseError(response);
    const result = await response.json();
    mergeMoments([result.moment]);
    closeCommentDialog(true);
  } catch (error) { els.commentStatus.textContent = error.message || "评论失败"; }
  finally { submit.disabled = false; }
}

function applyAvatars() {
  document.querySelectorAll("[data-avatar-id]").forEach((node) => applyAvatar(node, node.dataset.avatarId));
  memberProfile.refresh();
}

function createAvatar(id) {
  const node = textElement("span", "avatar", initials[id] || id.slice(0, 2));
  node.dataset.avatarId = id === "shin" ? "glm" : id;
  applyAvatar(node, node.dataset.avatarId);
  return node;
}

function applyAvatar(node, id) {
  const url = state.avatars[id] || "";
  node.style.backgroundImage = url ? `url(${JSON.stringify(imageVariantUrl(url, 192))})` : "";
  node.classList.toggle("has-photo", Boolean(url));
}

async function uploadMemberAvatar(id, image) {
  const response = await apiFetch(`/api/avatars/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "头像更新失败");
  state.avatars[id] = payload.avatar.url;
  persistUiState();
  applyAvatars();
  renderFeed();
  return payload.avatar;
}

async function resetMemberAvatar(id) {
  if (!state.avatars[id]) return;
  const response = await apiFetch(`/api/avatars/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("恢复默认头像失败");
  delete state.avatars[id];
  persistUiState();
  applyAvatars();
  renderFeed();
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

function applyCover(url) {
  els.cover.style.backgroundImage = url ? `url(${JSON.stringify(imageVariantUrl(url, 1200))})` : "";
  els.cover.classList.toggle("custom-cover", Boolean(url));
}

async function updateCover(file) {
  els.coverImageInput.value = "";
  if (!file) return;
  const previous = state.coverUrl;
  els.changeCover.disabled = true;
  els.changeCover.textContent = "正在更换……";
  try {
    const image = await prepareUploadImage(file, { maxDimension: 2400, quality: 0.88 });
    applyCover(image.dataUrl);
    const response = await apiFetch("/api/moments/cover", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image }),
    });
    if (!response.ok) throw await responseError(response);
    const payload = await response.json();
    state.coverUrl = payload.coverUrl || "";
    applyCover(state.coverUrl);
    showToast("封面换好了");
  } catch (error) {
    applyCover(previous);
    showToast(error.message || "封面更换失败");
  } finally {
    els.changeCover.disabled = false;
    els.changeCover.textContent = "更换封面";
  }
}

function versionedImageUrl(url, version, width = 0) {
  if (!String(url || "").startsWith("/uploads/")) return url;
  const next = new URL(url, location.origin);
  next.searchParams.set("v", String(version || "1"));
  if (width) next.searchParams.set("w", String(width));
  return `${next.pathname}${next.search}`;
}

function retryMomentImage(image, originalUrl) {
  if (!String(originalUrl || "").startsWith("/uploads/") || image.dataset.retried) return;
  image.dataset.retried = "true";
  setTimeout(() => {
    const retry = new URL(imageVariantUrl(originalUrl, 720), location.origin);
    retry.searchParams.set("reload", String(Date.now()));
    image.src = `${retry.pathname}${retry.search}`;
  }, 180);
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
  const previous = readCachedUiState();
  localStorage.setItem("roundtable.uiState.v1", JSON.stringify({
    ...previous,
    avatars: state.avatars,
    signatures: state.signatures,
  }));
}

async function prepareUploadImage(file, { maxDimension = 2048, quality = 0.86 } = {}) {
  if (file.type === "image/gif") {
    if (file.size > 6_000_000) throw new Error("GIF 不能超过 6 MB");
    return { name: file.name, mimeType: file.type, dataUrl: await fileToDataUrl(file) };
  }
  const dataUrl = await fileToDataUrl(file);
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const output = canvas.toDataURL("image/jpeg", quality);
  if (output.length > 8_000_000) throw new Error("处理后的图片仍然过大");
  return { name: `${file.name.replace(/\.[^.]+$/u, "") || "photo"}.jpg`, mimeType: "image/jpeg", dataUrl: output };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败"));
    image.src = url;
  });
}

function dataUrlMime(value) {
  return /^data:([^;,]+)/u.exec(String(value || ""))?.[1] || "image/jpeg";
}

function openLightbox(url) {
  els.lightboxImage.src = url;
  els.lightbox.hidden = false;
}

function closeLightbox() {
  els.lightbox.hidden = true;
  els.lightboxImage.removeAttribute("src");
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toLocaleDateString("zh-CN") === now.toLocaleDateString("zh-CN");
  if (sameDay) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function displayName(id) { return names[id] || id; }
function readSeenAt() { try { const value = JSON.parse(localStorage.getItem("roundtable.seenAt") || "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; } }
function initializeSeenState(messages) {
  if (state.hasSeenState) return;
  for (const channel of ["group", "gen", "kimi", "glm"]) {
    const latest = [...messages].reverse().find((message) => (message.channel || "group") === channel && message.role === "assistant" && !message.pending);
    state.seenAt[channel] = Date.parse(latest?.createdAt || "") || 0;
  }
  state.hasSeenState = true;
  localStorage.setItem("roundtable.seenAt", JSON.stringify(state.seenAt));
}
function renderChatUnread(messages) {
  if (!els.chatUnread) return;
  els.chatUnread.hidden = !messages.some((message) => {
    if (message.role !== "assistant" || message.pending) return false;
    const channel = message.channel || "group";
    return (Date.parse(message.createdAt || "") || 0) > Number(state.seenAt[channel] || 0);
  });
}
function element(tag, className = "") { const node = document.createElement(tag); if (className) node.className = className; return node; }
function textElement(tag, className, text) { const node = element(tag, className); node.textContent = text; return node; }
function fileToDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = reject; reader.readAsDataURL(file); }); }

function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = sessionStorage.getItem("roundtable.accessToken");
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

async function responseError(response) {
  const payload = await response.json().catch(() => ({}));
  return new Error(payload.error || `请求失败 (${response.status})`);
}

function showConnection(message) {
  els.connection.textContent = message;
  els.connection.hidden = false;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { els.toast.hidden = true; }, 1500);
}
