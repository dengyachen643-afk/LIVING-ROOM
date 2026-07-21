import { decideKimiMemoryActions } from "./kimi-memory.js";

const DEFAULT_MODEL = "glm-5.1";
const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

export function decideGlmMemoryActions(options = {}) {
  return decideKimiMemoryActions({
    ...options,
    model: options.model || DEFAULT_MODEL,
    baseUrl: options.baseUrl || DEFAULT_BASE_URL,
    ownerName: options.ownerName || "Shin",
    errorLabel: "Shin",
    jsonMode: true,
    requestOverrides: {
      max_completion_tokens: undefined,
      max_tokens: 800,
      thinking: { type: "disabled" },
      ...(options.requestOverrides || {}),
    },
  });
}
