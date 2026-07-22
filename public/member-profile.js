const MEMBER_NAMES = { okra: "Okra", gen: "Gen", kimi: "Kimi", glm: "Shin", k: "K" };
const MEMBER_INITIALS = { okra: "O", gen: "G", kimi: "Ki", glm: "S", k: "K" };
const MEMBER_REGIONS = {
  okra: "中国 广东",
  gen: "日本 京都府京都市左京区",
  kimi: "中国香港 深水埗",
  glm: "中国 上海市徐汇区",
  k: "英国 伦敦",
};
const MEMBER_IDS = new Set(Object.keys(MEMBER_NAMES));
const AVATAR_CROP_SIZE = 640;

export function createMemberProfile(options) {
  const host = document.createElement("div");
  host.className = "member-profile-host";
  host.innerHTML = `
    <section class="member-profile-page" role="dialog" aria-modal="true" aria-label="个人资料" hidden>
      <header class="member-profile-header">
        <button class="member-profile-back" type="button" aria-label="返回"><span aria-hidden="true"></span></button>
        <span></span><span class="member-profile-header-spacer"></span>
      </header>
      <article class="member-profile-card">
        <button class="member-profile-avatar-button" type="button" aria-label="查看个人头像"><span class="member-profile-avatar"></span></button>
        <div class="member-profile-identity"><strong class="member-profile-name"></strong><span class="member-profile-region"></span></div>
      </article>
      <section class="member-profile-section">
        <button class="member-profile-signature-row" type="button">
          <strong>个性签名</strong><span class="member-profile-signature"></span><span class="member-profile-chevron">›</span>
        </button>
        <form class="member-profile-signature-editor" hidden>
          <textarea maxlength="15" aria-label="个性签名" placeholder="最多15个字"></textarea>
          <div class="member-profile-signature-actions"><button class="member-profile-signature-cancel" type="button">取消</button><button class="member-profile-signature-save" type="submit">保存</button></div>
        </form>
      </section>
      <button class="member-profile-message" type="button"><span class="member-profile-message-icon" aria-hidden="true"></span><span>发消息</span></button>
      <p class="member-profile-status" role="status" aria-live="polite"></p>
    </section>
    <section class="profile-avatar-page" role="dialog" aria-modal="true" aria-label="个人头像" hidden>
      <header class="profile-avatar-header">
        <button class="profile-avatar-close" type="button" aria-label="返回个人资料">‹</button>
        <strong class="profile-avatar-title">个人头像</strong>
        <button class="profile-avatar-menu" type="button" aria-label="头像选项">•••</button>
      </header>
      <div class="profile-avatar-stage"><span class="profile-avatar-image"></span></div>
      <button class="profile-avatar-sheet-backdrop" type="button" aria-label="关闭头像选项" hidden></button>
      <div class="profile-avatar-sheet" role="menu" hidden>
        <button class="profile-avatar-choose" type="button">从手机相册选择</button>
        <button class="profile-avatar-reset" type="button">恢复默认头像</button>
        <button class="profile-avatar-sheet-cancel" type="button">取消</button>
      </div>
      <input class="profile-avatar-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
    </section>
    <section class="profile-crop-layer" role="dialog" aria-modal="true" aria-label="裁剪头像" hidden>
      <div class="profile-crop-card">
        <header class="profile-crop-header"><div><strong>裁剪头像</strong><span>拖动图片调整位置</span></div><button class="profile-crop-close" type="button" aria-label="取消裁剪">×</button></header>
        <div class="profile-crop-stage"><canvas width="640" height="640" aria-label="头像裁剪区域"></canvas><span class="profile-crop-guide"></span></div>
        <label class="profile-crop-zoom"><span>缩放</span><input type="range" min="0.05" max="4" step="0.01" value="1"></label>
        <footer class="profile-crop-actions"><button class="profile-crop-cancel" type="button">取消</button><button class="profile-crop-confirm" type="button">使用这个头像</button></footer>
      </div>
    </section>`;
  document.body.append(host);

  const page = host.querySelector(".member-profile-page");
  const back = host.querySelector(".member-profile-back");
  const avatarButton = host.querySelector(".member-profile-avatar-button");
  const avatar = host.querySelector(".member-profile-avatar");
  const name = host.querySelector(".member-profile-name");
  const region = host.querySelector(".member-profile-region");
  const signatureRow = host.querySelector(".member-profile-signature-row");
  const signature = host.querySelector(".member-profile-signature");
  const signatureChevron = host.querySelector(".member-profile-chevron");
  const signatureEditor = host.querySelector(".member-profile-signature-editor");
  const signatureInput = signatureEditor.querySelector("textarea");
  const signatureCancel = host.querySelector(".member-profile-signature-cancel");
  const messageButton = host.querySelector(".member-profile-message");
  const status = host.querySelector(".member-profile-status");
  const avatarPage = host.querySelector(".profile-avatar-page");
  const avatarClose = host.querySelector(".profile-avatar-close");
  const avatarMenu = host.querySelector(".profile-avatar-menu");
  const avatarImage = host.querySelector(".profile-avatar-image");
  const sheet = host.querySelector(".profile-avatar-sheet");
  const sheetBackdrop = host.querySelector(".profile-avatar-sheet-backdrop");
  const chooseAvatar = host.querySelector(".profile-avatar-choose");
  const resetAvatar = host.querySelector(".profile-avatar-reset");
  const cancelSheet = host.querySelector(".profile-avatar-sheet-cancel");
  const avatarInput = host.querySelector(".profile-avatar-input");
  const cropLayer = host.querySelector(".profile-crop-layer");
  const cropCanvas = host.querySelector(".profile-crop-stage canvas");
  const cropZoom = host.querySelector(".profile-crop-zoom input");
  const cropClose = host.querySelector(".profile-crop-close");
  const cropCancel = host.querySelector(".profile-crop-cancel");
  const cropConfirm = host.querySelector(".profile-crop-confirm");
  let currentId = "";
  let returnFocus = null;
  let cropSession = null;
  let profileSwipe = null;
  let profileSwipeTimer = 0;

  document.addEventListener("click", (event) => {
    if (host.contains(event.target)) return;
    const target = event.target.closest?.("[data-avatar-id]");
    if (target?.closest(".conversation-list")) return;
    const id = target?.dataset.avatarId;
    if (!MEMBER_IDS.has(id)) return;
    event.preventDefault();
    event.stopPropagation();
    open(id);
  }, true);
  back.addEventListener("click", close);
  avatarButton.addEventListener("click", openAvatarPage);
  avatarClose.addEventListener("click", closeAvatarPage);
  avatarMenu.addEventListener("click", openSheet);
  sheetBackdrop.addEventListener("click", closeSheet);
  cancelSheet.addEventListener("click", closeSheet);
  chooseAvatar.addEventListener("click", () => {
    closeSheet();
    avatarInput.value = "";
    avatarInput.click();
  });
  resetAvatar.addEventListener("click", async () => {
    closeSheet();
    status.textContent = "正在恢复默认头像……";
    try {
      await options.onResetAvatar?.(currentId);
      status.textContent = "已恢复默认头像";
      refresh();
    } catch (error) {
      status.textContent = error.message || "恢复默认头像失败";
    }
  });
  avatarInput.addEventListener("change", async () => {
    const [file] = avatarInput.files || [];
    avatarInput.value = "";
    if (!file) return;
    status.textContent = "";
    try {
      const image = await prepareAvatarImage(file);
      if (!image) return;
      status.textContent = "正在更新头像……";
      await options.onUploadAvatar?.(currentId, image);
      status.textContent = "头像已更新";
      refresh();
    } catch (error) {
      status.textContent = error.message || "头像更新失败";
    }
  });
  signatureRow.addEventListener("click", () => {
    if (currentId !== "okra") return;
    signatureInput.value = options.getSignature?.(currentId) || "";
    signatureEditor.hidden = false;
    signatureInput.focus();
  });
  signatureCancel.addEventListener("click", () => { signatureEditor.hidden = true; });
  signatureEditor.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = signatureInput.value.trim();
    status.textContent = "正在保存……";
    try {
      await options.onSaveSignature?.(currentId, value);
      signatureEditor.hidden = true;
      status.textContent = "个性签名已保存";
      refresh();
    } catch (error) {
      status.textContent = error.message || "个性签名保存失败";
    }
  });
  messageButton.addEventListener("click", () => {
    if (!canMessage(currentId)) return;
    const targetId = currentId;
    close();
    options.onMessage?.(targetId);
  });
  cropClose.addEventListener("click", () => finishCrop(false));
  cropCancel.addEventListener("click", () => finishCrop(false));
  cropConfirm.addEventListener("click", () => finishCrop(true));
  cropZoom.addEventListener("input", () => {
    if (!cropSession) return;
    cropSession.zoom = Number(cropZoom.value) || 1;
    clampCrop();
    renderCrop();
  });
  cropCanvas.addEventListener("pointerdown", beginCropDrag);
  cropCanvas.addEventListener("pointermove", moveCropDrag);
  cropCanvas.addEventListener("pointerup", endCropDrag);
  cropCanvas.addEventListener("pointercancel", endCropDrag);
  page.addEventListener("touchstart", beginProfileEdgeSwipe, { passive: true });
  page.addEventListener("touchmove", moveProfileEdgeSwipe, { passive: false });
  page.addEventListener("touchend", endProfileEdgeSwipe, { passive: true });
  page.addEventListener("touchcancel", cancelProfileEdgeSwipe, { passive: true });
  cropCanvas.addEventListener("wheel", (event) => {
    if (!cropSession) return;
    event.preventDefault();
    cropSession.zoom = Math.max(0.05, Math.min(4, cropSession.zoom + (event.deltaY < 0 ? 0.08 : -0.08)));
    cropZoom.value = String(cropSession.zoom);
    clampCrop();
    renderCrop();
  }, { passive: false });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (cropSession) { event.stopImmediatePropagation(); return finishCrop(false); }
    if (!sheet.hidden) { event.stopImmediatePropagation(); return closeSheet(); }
    if (!avatarPage.hidden) { event.stopImmediatePropagation(); return closeAvatarPage(); }
    if (!page.hidden) { event.stopImmediatePropagation(); close(); }
  });

  function open(id) {
    if (!MEMBER_IDS.has(id)) return;
    if (page.hidden) returnFocus = document.activeElement;
    resetProfileSwipe();
    currentId = id;
    signatureEditor.hidden = true;
    status.textContent = "";
    refresh();
    page.hidden = false;
    document.documentElement.classList.add("member-profile-open");
    back.focus({ preventScroll: true });
  }

  function close() {
    if (page.hidden) return;
    resetProfileSwipe();
    closeAvatarPage();
    page.hidden = true;
    document.documentElement.classList.remove("member-profile-open");
    returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  }

  function beginProfileEdgeSwipe(event) {
    if (page.hidden || !avatarPage.hidden || cropSession || !sheet.hidden) return;
    const touch = event.touches?.[0];
    if (!touch || touch.clientX > 34) return;
    clearTimeout(profileSwipeTimer);
    profileSwipe = { startX: touch.clientX, startY: touch.clientY, deltaX: 0, horizontal: false };
    page.style.transition = "none";
  }

  function moveProfileEdgeSwipe(event) {
    if (!profileSwipe) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const deltaX = touch.clientX - profileSwipe.startX;
    const deltaY = touch.clientY - profileSwipe.startY;
    if (!profileSwipe.horizontal) {
      if (Math.abs(deltaY) > 12 && Math.abs(deltaY) >= Math.abs(deltaX)) return cancelProfileEdgeSwipe();
      if (deltaX < 8 || deltaX <= Math.abs(deltaY)) return;
      profileSwipe.horizontal = true;
    }
    if (deltaX <= 0) return;
    event.preventDefault();
    profileSwipe.deltaX = Math.min(window.innerWidth, deltaX);
    page.style.transform = `translate3d(${profileSwipe.deltaX}px, 0, 0)`;
  }

  function endProfileEdgeSwipe() {
    if (!profileSwipe) return;
    const shouldClose = profileSwipe.horizontal && profileSwipe.deltaX >= Math.min(88, window.innerWidth * 0.18);
    if (!shouldClose) return resetProfileSwipe(true);
    profileSwipe = null;
    page.style.transition = "transform 180ms cubic-bezier(.22,.72,.28,1)";
    page.style.transform = "translate3d(100%, 0, 0)";
    profileSwipeTimer = window.setTimeout(close, 180);
  }

  function cancelProfileEdgeSwipe() {
    resetProfileSwipe(true);
  }

  function resetProfileSwipe(animate = false) {
    clearTimeout(profileSwipeTimer);
    profileSwipeTimer = 0;
    profileSwipe = null;
    page.style.transition = animate ? "transform 160ms ease-out" : "none";
    page.style.transform = "";
    if (animate) profileSwipeTimer = window.setTimeout(() => { page.style.transition = ""; }, 160);
  }

  function refresh() {
    if (!currentId) return;
    const label = MEMBER_NAMES[currentId];
    const signatureValue = options.getSignature?.(currentId) || "";
    name.textContent = label;
    region.textContent = `地区：${MEMBER_REGIONS[currentId]}`;
    signature.textContent = signatureValue || (currentId === "okra" ? "点击填写" : "");
    signature.classList.toggle("empty", !signatureValue);
    signatureRow.disabled = currentId !== "okra";
    signatureChevron.hidden = currentId !== "okra";
    messageButton.hidden = currentId === "okra";
    messageButton.disabled = !canMessage(currentId);
    messageButton.querySelector("span:last-child").textContent = canMessage(currentId) ? "发消息" : "暂未开放私聊";
    applyAvatar(avatar, currentId);
    applyAvatar(avatarImage, currentId);
    resetAvatar.hidden = !options.getAvatarUrl?.(currentId);
  }

  function applyAvatar(node, id) {
    const url = options.getAvatarUrl?.(id) || "";
    const displayUrl = node.classList.contains("profile-avatar-image") ? url : avatarPreviewUrl(url);
    node.dataset.avatarId = id;
    node.classList.toggle("has-photo", Boolean(url));
    node.style.backgroundImage = displayUrl ? `url(${JSON.stringify(displayUrl)})` : "";
    node.textContent = url ? "" : MEMBER_INITIALS[id];
  }

  function avatarPreviewUrl(url) {
    if (!String(url || "").startsWith("/uploads/")) return url;
    const next = new URL(url, location.origin);
    next.searchParams.set("w", "192");
    return `${next.pathname}${next.search}`;
  }

  function canMessage(id) {
    return id !== "okra" && Boolean(options.canMessage?.(id));
  }

  function openAvatarPage() {
    refresh();
    avatarPage.hidden = false;
    avatarClose.focus({ preventScroll: true });
  }

  function closeAvatarPage() {
    closeSheet();
    avatarPage.hidden = true;
    if (!page.hidden) avatarButton.focus({ preventScroll: true });
  }

  function openSheet() {
    sheet.hidden = false;
    sheetBackdrop.hidden = false;
    chooseAvatar.focus();
  }

  function closeSheet() {
    sheet.hidden = true;
    sheetBackdrop.hidden = true;
  }

  async function prepareAvatarImage(file) {
    if (!new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]).has(file.type)) throw new Error("请选择 PNG、JPEG、WebP 或 GIF 图片");
    if (file.size > 25_000_000) throw new Error("原图不能超过 25 MB");
    const source = await readFileAsDataUrl(file);
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法读取这张图片"));
      element.src = source;
    });
    return openCropper(image);
  }

  function openCropper(image) {
    finishCrop(false);
    return new Promise((resolve) => {
      const coverScale = Math.max(AVATAR_CROP_SIZE / image.naturalWidth, AVATAR_CROP_SIZE / image.naturalHeight);
      const containScale = Math.min(AVATAR_CROP_SIZE / image.naturalWidth, AVATAR_CROP_SIZE / image.naturalHeight);
      const zoom = Math.max(0.05, containScale / coverScale);
      cropSession = { image, zoom, offsetX: 0, offsetY: 0, drag: null, resolve };
      cropZoom.value = String(zoom);
      cropLayer.hidden = false;
      renderCrop();
      cropConfirm.focus();
    });
  }

  function renderCrop(target = cropCanvas) {
    if (!cropSession || !target) return;
    const { image, zoom, offsetX, offsetY } = cropSession;
    const ratio = target.width / AVATAR_CROP_SIZE;
    const baseScale = Math.max(AVATAR_CROP_SIZE / image.naturalWidth, AVATAR_CROP_SIZE / image.naturalHeight);
    const width = image.naturalWidth * baseScale * zoom;
    const height = image.naturalHeight * baseScale * zoom;
    const context = target.getContext("2d");
    context.clearRect(0, 0, target.width, target.height);
    context.fillStyle = "#f5f5f2";
    context.fillRect(0, 0, target.width, target.height);
    context.drawImage(image, ((AVATAR_CROP_SIZE - width) / 2 + offsetX) * ratio, ((AVATAR_CROP_SIZE - height) / 2 + offsetY) * ratio, width * ratio, height * ratio);
  }

  function clampCrop() {
    if (!cropSession) return;
    const { image, zoom } = cropSession;
    const scale = Math.max(AVATAR_CROP_SIZE / image.naturalWidth, AVATAR_CROP_SIZE / image.naturalHeight) * zoom;
    const maxX = Math.max(0, (image.naturalWidth * scale - AVATAR_CROP_SIZE) / 2);
    const maxY = Math.max(0, (image.naturalHeight * scale - AVATAR_CROP_SIZE) / 2);
    cropSession.offsetX = Math.max(-maxX, Math.min(maxX, cropSession.offsetX));
    cropSession.offsetY = Math.max(-maxY, Math.min(maxY, cropSession.offsetY));
  }

  function beginCropDrag(event) {
    if (!cropSession) return;
    event.preventDefault();
    cropCanvas.setPointerCapture?.(event.pointerId);
    cropSession.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    cropCanvas.classList.add("dragging");
  }

  function moveCropDrag(event) {
    const drag = cropSession?.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const factor = AVATAR_CROP_SIZE / Math.max(1, cropCanvas.getBoundingClientRect().width);
    cropSession.offsetX += (event.clientX - drag.x) * factor;
    cropSession.offsetY += (event.clientY - drag.y) * factor;
    drag.x = event.clientX;
    drag.y = event.clientY;
    clampCrop();
    renderCrop();
  }

  function endCropDrag(event) {
    const drag = cropSession?.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    cropSession.drag = null;
    cropCanvas.classList.remove("dragging");
  }

  function finishCrop(accepted) {
    const session = cropSession;
    if (!session) return;
    let result = null;
    if (accepted) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      renderCrop(canvas);
      result = { name: `${currentId || "avatar"}.jpg`, mimeType: "image/jpeg", dataUrl: canvas.toDataURL("image/jpeg", 0.9) };
    }
    cropSession = null;
    cropLayer.hidden = true;
    cropCanvas.classList.remove("dragging");
    session.resolve(result);
  }

  return { open, close, refresh, isOpen: () => !page.hidden };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("无法读取这张图片"));
    reader.readAsDataURL(file);
  });
}
