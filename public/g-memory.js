const els = {
  authPanel: document.querySelector("#auth-panel"),
  authForm: document.querySelector("#auth-form"),
  tokenInput: document.querySelector("#token-input"),
  workspace: document.querySelector("#workspace"),
  connectionStatus: document.querySelector("#connection-status"),
  exportButton: document.querySelector("#export-button"),
  editor: document.querySelector("#memory-editor"),
  text: document.querySelector("#memory-text"),
  category: document.querySelector("#memory-category"),
  importance: document.querySelector("#memory-importance"),
  tags: document.querySelector("#memory-tags"),
  formKicker: document.querySelector("#form-kicker"),
  formTitle: document.querySelector("#form-title"),
  saveButton: document.querySelector("#save-button"),
  cancelEdit: document.querySelector("#cancel-edit"),
  search: document.querySelector("#memory-search"),
  count: document.querySelector("#memory-count"),
  list: document.querySelector("#memory-list"),
  toast: document.querySelector("#toast"),
};

const state = { memories: [], editingId: "", toastTimer: 0 };
const tokenFromUrl = new URLSearchParams(location.search).get("token");
if (tokenFromUrl) {
  sessionStorage.setItem("g.memoryToken", tokenFromUrl);
  history.replaceState(null, "", location.pathname);
}

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = els.tokenInput.value.trim();
  if (!token) return;
  sessionStorage.setItem("g.memoryToken", token);
  els.tokenInput.value = "";
  await connect();
});

els.editor.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.text.value.trim();
  if (!text) return;
  const tags = [els.category.value, ...els.tags.value.split(/[,，]/).map((tag) => tag.trim())]
    .filter(Boolean);
  const body = {
    text,
    namespace: "g",
    tags,
    importance: Number(els.importance.value),
    source: "g-teacher-editor",
    metadata: { category: els.category.value, owner: "g-teacher" },
  };
  const url = state.editingId ? `/api/memories/${encodeURIComponent(state.editingId)}` : "/api/memories";
  const response = await apiFetch(url, {
    method: state.editingId ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return showToast(payload.error || "保存失败");
  const index = state.memories.findIndex((memory) => memory.id === payload.memory.id);
  if (index >= 0) state.memories[index] = payload.memory;
  else state.memories.unshift(payload.memory);
  resetEditor();
  render();
  showToast("已经记住了");
});

els.list.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const memory = state.memories.find((item) => item.id === button.dataset.id);
  if (!memory) return;
  if (button.dataset.action === "edit") {
    state.editingId = memory.id;
    els.text.value = memory.text;
    els.category.value = memory.metadata?.category || memory.tags?.[0] || "其他";
    els.importance.value = String(memory.importance || 3);
    els.tags.value = (memory.tags || []).filter((tag) => tag !== els.category.value).join("，");
    els.formKicker.textContent = "EDIT MEMORY";
    els.formTitle.textContent = "修改这段记忆";
    els.saveButton.textContent = "保存修改";
    els.cancelEdit.hidden = false;
    els.text.focus();
    scrollTo({ top: 0, behavior: "smooth" });
  }
  if (button.dataset.action === "delete") {
    if (!confirm("删除这条记忆？")) return;
    const response = await apiFetch(`/api/memories/${encodeURIComponent(memory.id)}`, { method: "DELETE" });
    if (!response.ok) return showToast("删除失败");
    state.memories = state.memories.filter((item) => item.id !== memory.id);
    if (state.editingId === memory.id) resetEditor();
    render();
    showToast("已删除");
  }
});

els.cancelEdit.addEventListener("click", resetEditor);
els.search.addEventListener("input", render);
els.exportButton.addEventListener("click", () => {
  const payload = state.memories.map(({ id, text, tags, importance, metadata, createdAt, updatedAt }) => ({
    id, text, tags, importance, metadata, createdAt, updatedAt,
  }));
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `g-teacher-memory-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

await connect();

async function connect() {
  const [gResponse, legacyResponse] = await Promise.all([
    apiFetch("/api/memories?namespace=g&limit=200"),
    apiFetch("/api/memories?namespace=gpt&limit=200"),
  ]);
  if (!gResponse.ok || !legacyResponse.ok) {
    sessionStorage.removeItem("g.memoryToken");
    els.authPanel.hidden = false;
    els.workspace.hidden = true;
    els.connectionStatus.textContent = "密钥无效";
    return showToast("无法打开记忆册，请检查编辑密钥");
  }
  const [gPayload, legacyPayload] = await Promise.all([gResponse.json(), legacyResponse.json()]);
  state.memories = [...(gPayload.memories || []), ...(legacyPayload.memories || [])]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  els.authPanel.hidden = true;
  els.workspace.hidden = false;
  els.exportButton.hidden = false;
  els.connectionStatus.textContent = "已连接 · 可编辑";
  render();
}

function render() {
  const query = els.search.value.trim().toLowerCase();
  const memories = state.memories
    .filter((memory) => !query || `${memory.text} ${(memory.tags || []).join(" ")}`.toLowerCase().includes(query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  els.count.textContent = String(memories.length);
  els.list.replaceChildren();
  if (!memories.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = query ? "没有匹配的记忆" : "还没有写入记忆";
    els.list.append(empty);
    return;
  }
  for (const memory of memories) {
    const card = document.createElement("article");
    card.className = "memory-card";
    const text = document.createElement("p");
    text.textContent = memory.text;
    const meta = document.createElement("div");
    meta.className = "memory-meta";
    const values = [
      ...(memory.tags || []).slice(0, 4),
      `重要度 ${memory.importance || 3}`,
      memory.vectorStatus === "indexed" ? "已向量化" : "待向量化",
    ];
    for (const value of values) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = value;
      meta.append(chip);
    }
    const actions = document.createElement("div");
    actions.className = "memory-actions";
    actions.append(actionButton("编辑", "edit", memory.id), actionButton("删除", "delete", memory.id, "delete"));
    card.append(text, meta, actions);
    els.list.append(card);
  }
}

function actionButton(label, action, id, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.action = action;
  button.dataset.id = id;
  button.className = className;
  button.textContent = label;
  button.setAttribute("aria-label", `${label}记忆：${state.memories.find((item) => item.id === id)?.text.slice(0, 24) || ""}`);
  return button;
}

function resetEditor() {
  state.editingId = "";
  els.editor.reset();
  els.importance.value = "3";
  els.formKicker.textContent = "NEW MEMORY";
  els.formTitle.textContent = "记住一件事";
  els.saveButton.textContent = "保存到 G老师记忆";
  els.cancelEdit.hidden = true;
}

function showToast(text) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = text;
  els.toast.hidden = false;
  state.toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2400);
}

function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = sessionStorage.getItem("g.memoryToken");
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}
