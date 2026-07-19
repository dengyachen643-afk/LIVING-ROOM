const DEFAULT_FORMULAS = ["moonshot/web-search:latest", "moonshot/fetch:latest"];

export class KimiFormulaTools {
  constructor({ fetchImpl = globalThis.fetch, formulas = DEFAULT_FORMULAS, cacheMs = 10 * 60_000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.formulas = formulas;
    this.cacheMs = cacheMs;
    this.cached = null;
  }

  async getTools({ apiKey, baseUrl, signal } = {}) {
    if (this.cached && Date.now() - this.cached.createdAt < this.cacheMs) return this.cached;
    const tools = [];
    const toolToFormula = new Map();
    for (const formula of this.formulas) {
      const response = await this.fetchImpl(`${stripSlash(baseUrl)}/formulas/${formula}/tools`, {
        headers: { authorization: `Bearer ${clean(apiKey)}` },
        signal,
      });
      if (!response.ok) continue;
      const payload = await response.json().catch(() => ({}));
      for (const tool of Array.isArray(payload?.tools) ? payload.tools : []) {
        const name = clean(tool?.function?.name);
        if (!name || toolToFormula.has(name)) continue;
        tools.push(tool);
        toolToFormula.set(name, formula);
      }
    }
    this.cached = { tools, toolToFormula, createdAt: Date.now() };
    return this.cached;
  }

  async execute({ apiKey, baseUrl, call, signal } = {}) {
    const registry = await this.getTools({ apiKey, baseUrl, signal });
    const name = clean(call?.function?.name);
    const formula = registry.toolToFormula.get(name);
    if (!formula) throw new Error(`未注册的 Kimi 工具：${name || "unknown"}`);
    const rawArguments = clean(call?.function?.arguments) || "{}";
    const response = await this.fetchImpl(`${stripSlash(baseUrl)}/formulas/${formula}/fibers`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${clean(apiKey)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, arguments: rawArguments }),
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(clean(payload?.error?.message || payload?.message) || `Kimi 工具执行失败 (${response.status})`);
    const result = payload?.context?.output || payload?.context?.encrypted_output;
    if (payload?.status !== "succeeded" || !result) {
      throw new Error(clean(payload?.error || payload?.context?.error || payload?.context?.output) || "Kimi 工具没有返回结果");
    }
    return String(result).slice(0, 250_000);
  }
}

export function toolLabel(name) {
  if (name === "web_search") return "联网搜索";
  if (/fetch|crawl|url/iu.test(name)) return "读取网页";
  return name || "工具";
}

function stripSlash(value) {
  return clean(value).replace(/\/+$/u, "");
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
