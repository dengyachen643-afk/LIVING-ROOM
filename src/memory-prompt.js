export function memoryPromptLine(memory, { includeId = false } = {}) {
  const text = clean(memory?.text);
  if (!text) return "";
  const id = includeId && clean(memory?.id) ? `[${clean(memory.id)}] ` : "";
  if (memory?.memoryKind === "short_term") {
    return `- ${id}[短期记忆，可能已经变化] ${text}`;
  }
  if (memory?.memoryKind === "event") {
    const date = clean(memory?.date);
    const participants = Array.isArray(memory?.participants) ? memory.participants.map(clean).filter(Boolean).join("/") : "";
    const detail = [date, participants].filter(Boolean).join(" · ");
    return `- ${id}[事件${detail ? ` · ${detail}` : ""}] ${text}`;
  }
  return `- ${id}[长期记忆] ${text}`;
}

export function memoryContextGuidance() {
  return "长期记忆相对稳定；短期记忆会自然淡出且可能已经变化；事件记忆只表示过去发生过的事。三者与 Okra 当前明确说法冲突时，一律以当前说法为准。";
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
