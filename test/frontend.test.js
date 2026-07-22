import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("frontend initializes only after render state is declared", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const renderState = source.indexOf("let draftRenderFrame = 0;");
  const initializeCall = source.lastIndexOf("await initialize();");

  assert.ok(renderState >= 0, "draft render state should exist");
  assert.ok(initializeCall > renderState, "initialize must run after draft render state leaves the temporal dead zone");
});

test("chat history has server archive search and incremental older-message loading", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="chat-info-search"/u);
  assert.match(html, /id="history-search-members"/u);
  assert.match(html, /id="history-search-close"[^>]*>×<\/button>/u);
  assert.match(html, /id="history-search-panel"/u);
  assert.match(html, /id="load-earlier-messages"/u);
  assert.match(source, /apiFetch\(`\/api\/history\?\$\{parameters\}`\)/u);
  assert.match(source, /async function openArchivedMessage/u);
  assert.doesNotMatch(source, /state\.history\.length > 300/u);
});

test("every conversation has a WeChat-style information menu with scoped tools", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(html, /id="chat-info-button"[^>]*>•••<\/button>/u);
  assert.match(html, /id="chat-info-panel"/u);
  assert.match(html, /id="chat-info-members"/u);
  assert.match(html, /id="chat-info-members-section"/u);
  assert.match(html, /id="chat-info-name"/u);
  assert.match(html, /id="chat-info-name-section"/u);
  assert.match(html, /id="chat-info-memory"/u);
  assert.match(html, /id="chat-info-search"/u);
  assert.match(html, /id="chat-info-background"/u);
  assert.doesNotMatch(html, /id="kimi-memory-button"/u);
  assert.doesNotMatch(html, /id="history-search-button"/u);
  assert.match(source, /new URLSearchParams\(\{ limit: "50", channel: state\.activeChat \}\)/u);
  assert.match(source, /apiFetch\(`\/api\/chat-backgrounds\/\$\{encodeURIComponent\(channel\)\}`/u);
  assert.match(source, /function renderChatInfo/u);
  assert.match(source, /els\.chatInfoMembersSection\.hidden = !isGroup/u);
  assert.match(source, /els\.chatInfoNameSection\.hidden = !isGroup/u);
  assert.match(source, /searchReturnToInfo/u);
  assert.doesNotMatch(
    source.slice(source.indexOf("function openHistorySearch"), source.indexOf("function closeHistorySearch")),
    /els\.chatInfoPanel\.hidden = true/u,
  );
  assert.match(source, /function renderHistoryMemberFilters/u);
  assert.match(source, /parameters\.set\("member", member\)/u);
  assert.match(source, /function applyChatBackground/u);
  assert.match(css, /\.chat-info-panel/u);
  assert.match(css, /\.history-search-panel \{[^}]*inset: 0;[^}]*width: 100vw;/u);
  assert.match(css, /\.chat\.has-chat-background/u);
});

test("the group composer supports user interjections during an AI reply chain", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /const runningHere = isRunning\(state\.activeChat\)/u);
  assert.match(source, /const canInterject = runningHere && state\.activeChat === "group"/u);
  assert.match(source, /async function interjectGroupMessage/u);
  assert.match(source, /await waitForGroupRunToStop\(\)/u);
  assert.doesNotMatch(source, /event\.preventDefault\(\);\s*if \(state\.running\) return;/u);
});

test("each conversation has independent running state and private draft state", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /runningChannels: new Set\(\)/u);
  assert.match(source, /drafts: \{ kimi: null, gen: null, glm: null \}/u);
  assert.match(source, /function isRunning\(channel\)/u);
  assert.doesNotMatch(source, /state\.running\b|state\.runningChannel\b|state\.draft\b/u);
});

test("Kimi replies can be recovered after a mobile connection interruption", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /messageId: optimistic\.id/u);
  assert.match(source, /async function recoverKimiResult/u);
  assert.match(source, /\/api\/kimi\/status\?sessionId=/u);
  assert.match(source, /void resumePendingKimiReply\(\)/u);
});

test("group replies continue on the server and resync after a mobile background disconnect", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /messageId: optimistic\.id/u);
  assert.match(source, /async function recoverGroupResult/u);
  assert.match(source, /\/api\/group\/status\?/u);
  assert.match(source, /void resumePendingGroupReply\(\)/u);
  assert.match(source, /大家仍在后台回复/u);
});

test("switching conversations keeps every channel running and hides raw load failures", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const setActiveStart = source.indexOf("function setActiveChat(");
  const setActiveEnd = source.indexOf("\nfunction applyPrivateAuthState", setActiveStart);
  const setActiveSource = source.slice(setActiveStart, setActiveEnd);
  assert.doesNotMatch(setActiveSource, /\.abort\(|setRunning\(/u);
  assert.match(source, /function isTransientConnectionError/u);
  assert.match(source, /load failed\|failed to fetch/iu);
  assert.match(source, /async function resumePendingGenReply/u);
  assert.match(source, /recoverPrivateResult\("gen", optimistic\.id, "Gen"\)/u);
});

test("Shin has an independent private chat and one-time server key setup", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /data-chat="glm"/u);
  assert.match(html, /id="glm-setup"/u);
  assert.match(source, /async function sendGlmMessage/u);
  assert.match(source, /apiFetch\("\/api\/glm\/chat"/u);
  assert.match(source, /async function resumePendingGlmReply/u);
  assert.match(source, /async function saveGlmKeyToServer/u);
  assert.match(source, /provider\.id === "glm" && shouldWelcomeGlm/u);
  assert.match(source, /state\.memorySyncVersion\.glm \+= 1/u);
  assert.match(source, /scheduleMemorySync\("glm", "Shin", state\.memorySyncVersion\.glm\)/u);
});

test("Gen work accepts guidance while running and every chat composer has an empty placeholder", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(source, /const canGuide = runningHere && state\.activeChat === "gen"/u);
  assert.match(source, /async function sendGenGuidance/u);
  assert.match(source, /apiFetch\("\/api\/gen\/guide"/u);
  assert.match(source, /els\.input\.placeholder = ""/u);
  assert.match(html, /id="message-input"[^>]+placeholder=""/u);
  assert.doesNotMatch(source, /告诉 Gen 要完成什么任务/u);
});

test("each conversation keeps an independent text draft and the emoji picker is removed", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(html, /emoji-button|emoji-panel/u);
  assert.doesNotMatch(source, /emojiButton|emojiPanel/u);
  assert.doesNotMatch(css, /emoji-button|emoji-panel/u);
  assert.match(source, /composerDrafts: readComposerDrafts\(\)/u);
  assert.match(source, /if \(previousChat !== chat\) saveComposerDraft\(previousChat\)/u);
  assert.match(source, /restoreComposerDraft\(chat\)/u);
  assert.match(source, /roundtable\.composerDrafts\.v1/u);
  assert.match(source, /state\.composerDrafts\[state\.activeChat\] = ""/u);
});

test("the mobile keyboard correction stays local to the active conversation", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(source, /function installLocalizedKeyboardInset/u);
  assert.match(source, /const unadjustedBottom = composerBottom \+ composerKeyboard\.inset/u);
  assert.match(source, /measuredInset >= 96 && measuredInset <= maxInset/u);
  assert.match(source, /composerKeyboard\.followLatest = isNearBottom\(160\)/u);
  assert.match(source, /composerKeyboard\.baselineHeight = Math\.max/u);
  assert.match(source, /els\.mainPanel\.style\.setProperty\("--keyboard-inset"/u);
  assert.doesNotMatch(source, /--app-viewport-height/u);
  assert.match(css, /padding-bottom: var\(--keyboard-inset, 0px\)/u);
});

test("long press offers a contextual copy, quote, and local-delete menu", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(html, /id="message-action-quote"/u);
  assert.match(html, /id="message-action-copy"/u);
  assert.match(html, /id="message-action-delete"/u);
  assert.match(html, /id="message-action-menu"/u);
  assert.doesNotMatch(html, /id="message-action-cancel"/u);
  assert.match(html, /id="quote-preview"/u);
  assert.match(source, /openMessageActions\(target\)/u);
  assert.match(source, /function selectMessageQuote/u);
  assert.match(source, /slice\(0, 2_000\)\.join/u);
  assert.match(source, /quote: normalizeClientQuote\(metadata\.quote\)/u);
  assert.match(source, /roundtable\.hiddenMessageIds\.v1/u);
  assert.match(source, /function hideMessageLocally/u);
  assert.match(source, /function positionMessageActionMenu/u);
  assert.match(source, /function trackMessageActionPosition/u);
  assert.match(source, /const visibleTop = Math\.max\(edge, chatRect\.top \+ 8\)/u);
  assert.match(source, /const anchorX = targetRect\.left \+ targetRect\.width \/ 2/u);
  assert.match(source, /if \(targetRect\.bottom <= visibleTop \|\| targetRect\.top >= visibleBottom\) return false/u);
  assert.match(source, /function openChatHome\(\) \{\s*closeMessageActions\(\)/u);
  assert.match(source, /addEventListener\("selectstart"/u);
  assert.match(source, /function clearBrowserSelection/u);
  assert.match(css, /\.message-quote/u);
  assert.match(css, /\.message-action-menu/u);
  assert.match(css, /\.message-action-overlay[^}]*background: transparent/u);
  assert.match(css, /grid-template-rows: 24px 14px/u);
  assert.match(css, /\.message-action-copy-icon::before/u);
  assert.match(css, /\.message-action-delete-icon::before/u);
  assert.match(css, /border: 1\.25px solid currentColor/u);
  assert.match(css, /\.message-body\.copyable \*[^{]*\{[^}]*user-select: none/u);
});

test("the room includes Shin among its customizable member avatars and counts Okra", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(html, /class="app-mark"|>聊</u);
  assert.match(html, /conversation-avatar[^<]*[\s\S]*?data-avatar-id="okra"[\s\S]*?data-avatar-id="gen"[\s\S]*?data-avatar-id="kimi"[\s\S]*?data-avatar-id="glm"[\s\S]*?data-avatar-id="k"/u);
  assert.match(source, /const memberCount = selected\.length \+ 1/u);
  assert.match(source, /async function uploadAvatar/u);
  assert.match(source, /\/api\/avatars\//u);
  assert.match(html, /id="avatar-crop-dialog"/u);
  assert.match(source, /function openAvatarCropper/u);
  assert.match(source, /function beginAvatarCropDrag/u);
  assert.match(source, /avatarCropSession\.zoom/u);
  assert.match(source, /function avatarContainZoom/u);
  assert.match(html, /id="avatar-crop-zoom"[^>]+min="0\.05"/u);
  assert.match(css, /\.avatar-crop-guide/u);
  assert.match(css, /\[data-avatar-id\]\.has-photo\s*\{[^}]*background-size:\s*cover\s*!important/su);
  assert.match(html, /<strong>Shin<\/strong>/u);
  assert.match(css, /--warm: #d98756/u);
  assert.match(css, /\.avatar-editor-list/u);
});

test("member avatars open a shared profile card without replacing the current page", async () => {
  const chatSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const momentsSource = await readFile(new URL("../public/moments.js", import.meta.url), "utf8");
  const profileSource = await readFile(new URL("../public/member-profile.js", import.meta.url), "utf8");
  const profileCss = await readFile(new URL("../public/profile.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="avatar-settings-button"/u);
  assert.match(chatSource, /createMemberProfile/u);
  assert.match(momentsSource, /createMemberProfile/u);
  assert.match(profileSource, /event\.target\.closest\?\.\("\[data-avatar-id\]"\)/u);
  assert.match(profileSource, /target\?\.closest\("\.conversation-list"\)/u);
  assert.match(profileSource, /member-profile-signature-row/u);
  assert.match(profileSource, /textarea maxlength="15"/u);
  assert.match(profileSource, /okra: "中国 广东"/u);
  assert.match(profileSource, /gen: "日本 京都府京都市左京区"/u);
  assert.match(profileSource, /kimi: "中国香港 深水埗"/u);
  assert.match(profileSource, /glm: "中国 上海市徐汇区"/u);
  assert.match(profileSource, /k: "英国 伦敦"/u);
  assert.match(profileSource, /member-profile-region/u);
  assert.match(profileSource, /profile-avatar-menu/u);
  assert.match(profileSource, /from|从手机相册选择/u);
  assert.match(profileSource, /returnFocus\?\.focus\?\.\(\{ preventScroll: true \}\)/u);
  assert.match(profileSource, /function beginProfileEdgeSwipe/u);
  assert.match(profileSource, /touch\.clientX > 34/u);
  assert.match(profileSource, /profileSwipe\.deltaX >= Math\.min\(88, window\.innerWidth \* 0\.18\)/u);
  assert.match(chatSource, /if \(memberProfile\.isOpen\(\) \|\| !els\.shell\.classList\.contains\("conversation-open"\)/u);
  assert.match(profileSource, /const targetId = currentId;\s+close\(\);\s+options\.onMessage\?\.\(targetId\);/u);
  assert.match(profileCss, /\.member-profile-page/u);
  assert.match(profileCss, /\.member-profile-header\s*\{[^}]*position:\s*sticky/su);
  assert.match(profileCss, /\.member-profile-back\s*>\s*span/u);
  assert.match(profileCss, /\.profile-avatar-sheet/u);
  assert.match(profileCss, /\.member-profile-message-icon[^}]+chat-nav-icon\.png/su);
  assert.match(momentsSource, /location\.replace\(`\/\?chat=\$\{encodeURIComponent\(id\)\}`\)/u);
  assert.match(chatSource, /setActiveChat\(state\.activeChat, Boolean\(requestedChatFromUrl\)\)/u);
});

test("incoming messages preserve the viewport while the user reads older messages", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /const followLatest = forceBottom \|\| isNearBottom\(\)/u);
  assert.match(source, /else els\.chat\.scrollTop = previousScrollTop/u);
  assert.match(source, /if \(followLatest\) scrollToBottom\(false\)/u);
  assert.match(source, /function isNearBottom\(threshold = 96\)/u);
});

test("Gen work mode sends a server-controlled workspace ID instead of a filesystem path", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /mode: state\.genRunContext\.mode/u);
  assert.match(source, /workspaceId: state\.genRunContext\.workspaceId/u);
  assert.match(source, /config\.genPrivate\?\.workspaces/u);
  assert.doesNotMatch(source, /workspaceDir: state\./u);
});

test("optional Gen work controls cannot block history initialization during a stale mobile cache", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /els\.genWorkbar\?\.addEventListener/u);
  assert.match(source, /if \(!els\.genWorkbar \|\| !els\.genWorkspace \|\| !els\.genWorkspaceWrap\) return;/u);
});

test("new Shin and avatar controls cannot disable an older cached mobile page", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(source, /els\.avatarSettings\?\.addEventListener/u);
  assert.match(source, /els\.avatarEditorList\?\.addEventListener/u);
  assert.match(source, /els\.glmSetup\?\.addEventListener/u);
  assert.match(source, /window\.addEventListener\("pageshow"/u);
  assert.match(source, /state\.runningChannels\.clear\(\)/u);
  assert.match(html, /app\.js\?v=\d{8}-\d+/u);
});

test("Moments navigation, custom cover and optimistic publishing stay mobile friendly", async () => {
  const chatHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const momentsHtml = await readFile(new URL("../public/moments.html", import.meta.url), "utf8");
  const momentsSource = await readFile(new URL("../public/moments.js", import.meta.url), "utf8");
  const momentsCss = await readFile(new URL("../public/moments.css", import.meta.url), "utf8");
  const shellCss = await readFile(new URL("../public/shell-nav.css", import.meta.url), "utf8");
  assert.doesNotMatch(chatHtml, /class="feature-nav"/u);
  assert.match(chatHtml, /class="bottom-nav"[\s\S]*href="\/moments"/u);
  assert.match(momentsHtml, /class="bottom-nav moments-bottom-nav"/u);
  assert.match(shellCss, /@view-transition/u);
  assert.doesNotMatch(chatHtml, /class="topbar-action moments-link"/u);
  assert.match(momentsHtml, /id="new-post-button" class="cover-publish-button"/u);
  assert.match(momentsHtml, /id="change-cover-button"/u);
  assert.match(momentsHtml, /id="cover-image-input"/u);
  assert.match(momentsSource, /pendingUpload: true/u);
  assert.match(momentsSource, /requestAnimationFrame\(\(\) => setTimeout\(\(\) => void sendPendingMoment\(optimistic\), 0\)\)/u);
  assert.match(momentsSource, /body: JSON\.stringify\(current\.pendingPayload\)/u);
  assert.match(momentsSource, /canvas\.toDataURL\("image\/jpeg"/u);
  assert.match(momentsSource, /apiFetch\("\/api\/moments\/cover"/u);
  assert.match(momentsCss, /\.cover-publish-button \{ right: 14px;/u);
  assert.match(momentsCss, /\.moment \{[^}]*background: #fff;/su);
  assert.match(momentsSource, /controls\.append\(actions, menu\)/u);
  assert.match(momentsCss, /\.moment-footer-controls \{[^}]*display: flex;[^}]*align-items: center;/su);
  assert.match(momentsHtml, /class="dialog-layer comment-layer"/u);
  assert.match(momentsSource, /function resizeCommentInput/u);
  assert.match(momentsSource, /window\.visualViewport\?\.addEventListener\("resize", syncCommentViewport\)/u);
  assert.match(momentsCss, /\.comment-layer\.open \.comment-card/u);
});

test("the chat home uses a WeChat-style list with per-chat unread dots", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const shellCss = await readFile(new URL("../public/shell-nav.css", import.meta.url), "utf8");
  assert.match(html, /data-unread="group"/u);
  assert.match(html, /conversation-avatar-wrap[^>]*>\s*<span class="conversation-avatar"[^>]*>[\s\S]*?<\/span><b class="conversation-unread" data-unread="group"/u);
  assert.match(html, /data-unread="gen"/u);
  assert.match(html, /data-unread="kimi"/u);
  assert.match(html, /data-unread="glm"/u);
  assert.match(html, /id="sidebar-toggle"[^>]*>‹<\/button>/u);
  assert.match(source, /function renderConversationList/u);
  assert.match(source, /function markChatRead/u);
  assert.match(source, /roundtable\.seenAt/u);
  assert.match(source, /els\.shell\.classList\.add\("conversation-open"\)/u);
  assert.match(source, /function openChatHome/u);
  assert.match(shellCss, /\.app-shell\.conversation-open \.main-panel/u);
  assert.match(shellCss, /\.conversation-unread/u);
  assert.match(source, /function installChatEdgeSwipe/u);
  assert.match(source, /livingRoomView: "conversation"/u);
  assert.match(source, /function handleChatPopState/u);
});

test("bottom navigation uses a frameless bubble and four-node moments icon", async () => {
  const css = await readFile(new URL("../public/shell-nav.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const moments = await readFile(new URL("../public/moments.html", import.meta.url), "utf8");
  assert.match(css, /\.bottom-nav-chat::before[^}]*chat-nav-icon\.png\?v=20260721-1/u);
  assert.match(css, /\.bottom-nav-chat i \{ display: none/u);
  assert.match(css, /\.bottom-nav-moments::before[^}]*border: 1\.8px solid currentColor/u);
  assert.match(css, /\.bottom-nav-moments i:nth-child\(4\)/u);
  assert.match(html, /shell-nav\.css\?v=\d{8}-\d+/u);
  assert.match(moments, /shell-nav\.css\?v=\d{8}-\d+/u);
  assert.match(css, /\.bottom-nav-item::before \{ display: none/u);
  assert.match(css, /\.bottom-nav-moments i[^}]*box-shadow: 0 0 0 2\.5px/u);
});

test("message text is serif while thinking stays sans and images use an in-page preview", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.message-content \{[^}]*font-family:[^}]*serif;/su);
  assert.match(css, /\.composer textarea \{[^}]*font-family:[^}]*serif;/su);
  assert.match(css, /@media \(max-width: 520px\) \{[\s\S]*?\.composer textarea \{ font-size: 17px; \}/u);
  assert.match(css, /\.app-shell \{[^}]*max-width: 100vw;[^}]*overflow: hidden;/su);
  assert.match(css, /\.chat \{[^}]*max-width: 100%;[^}]*overflow-x: hidden;/su);
  assert.match(css, /\.composer \{[^}]*width: 100%;[^}]*min-width: 0;/su);
  assert.match(css, /@font-face \{[^}]*Living Room Serif[^}]*\.woff2/su);
  assert.doesNotMatch(css, /\.thinking-content \{[^}]*font-family:[^}]*serif;/su);
  assert.match(html, /id="image-lightbox"/u);
  assert.match(source, /function openImageLightbox/u);
  assert.match(source, /function closeImageLightbox/u);
  assert.doesNotMatch(source, /window\.open\(attachment\.url/u);
});

test("sending a message updates one bubble and defers the local history backup", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /function replaceRenderedMessage/u);
  assert.match(source, /renderMessage\(message, true\)/u);
  assert.match(source, /historyPersistTimer = setTimeout\(flushPersistHistory, 250\)/u);
  assert.match(source, /state\.history\.slice\(-200\)/u);
  assert.match(source, /window\.addEventListener\("pagehide", flushPersistHistory\)/u);
});

test("startup paints cached history before parallel server synchronization", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /function hydrateCachedHistory/u);
  assert.match(source, /renderAvatars\(\);\s*hydrateCachedHistory\(\);\s*void refreshUiState\(\);\s*await initialize\(\);/u);
  assert.match(source, /roundtable\.uiState\.v1/u);
  assert.match(source, /apiFetch\("\/api\/ui-state"\)/u);
  assert.match(source, /let \[response, stateResponse\] = await Promise\.all/u);
});

test("uploaded images are resized before sending and list media uses cached variants", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const moments = await readFile(new URL("../public/moments.js", import.meta.url), "utf8");
  assert.match(source, /async function optimizeImageForSend/u);
  assert.match(source, /const maxDimension = 1800/u);
  assert.match(source, /await paintPendingUi\(\)/u);
  assert.match(source, /imageVariantUrl\(attachment\.url, 720\)/u);
  assert.match(moments, /versionedImageUrl\(item\.url, version, 720\)/u);
  assert.match(moments, /imageVariantUrl\(url, 192\)/u);
});

test("Gen work mode hides raw commands and recovers a result after a dropped stream", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /message\.role === "assistant" && message\.mode !== "work" && \(message\.pending \|\| \(Array\.isArray\(message\.toolCalls\)/u);
  assert.match(source, /Gen 正在干活…/u);
  assert.match(source, /\/api\/gen\/status\?sessionId=/u);
  assert.match(source, /await recoverGenWorkResult\(optimistic\.id\)/u);
});

test("an optimistic user message never enters assistant tool or thinking rendering", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /message\.role === "assistant" && message\.mode !== "work"/u);
  assert.match(source, /for \(const call of message\.toolCalls \|\| \[\]\)/u);
  assert.match(source, /message\.role === "assistant" && \(message\.reasoning \|\| message\.pending\)/u);
});

test("Kimi streaming updates a stable draft without replaying whole-history animations", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(source, /message\.reasoning \|\| message\.pending/u);
  assert.match(source, /visibleContent \|\| message\.pending/u);
  assert.match(source, /thinking\.hidden = !draft\.reasoning/u);
  assert.match(source, /content\.hidden = !visibleContent/u);
  assert.match(source, /if \(followLatest\) els\.chat\.scrollTop = els\.chat\.scrollHeight/u);
  assert.match(css, /\.message-enter \{ animation: rise/u);
  assert.doesNotMatch(css, /\.message \{[^}]*animation:/u);
  assert.doesNotMatch(css, /\.run-status::before \{[^}]*animation:/u);
});

test("typing labels never expose thinking status and legacy user replies display Okra", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /activity\.name === "web_search"[\s\S]*正在联网搜索/u);
  assert.doesNotMatch(source, /正在思考/u);
  assert.match(source, /Kimi 正在输入/u);
  assert.match(source, /message\.triggeredBy === "用户" \? "Okra"/u);
});

test("the page periodically syncs proactive server messages", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /async function syncServerMessages/u);
  assert.match(source, /setInterval\(\(\) => void syncServerMessages\(\), 15_000\)/u);
  assert.match(source, /document\.visibilityState === "visible"/u);
  assert.match(source, /if \(message\.proactive\) labels\.unshift\("主动消息"\)/u);
});
