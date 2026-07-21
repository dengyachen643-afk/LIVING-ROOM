const PROMPT_TIME_ZONE = "Asia/Shanghai";
const ENGLISH_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatPromptTime(value = new Date()) {
  const parts = promptTimeParts(value);
  if (!parts) return "时间未知";
  return `${parts.day} ${parts.weekday} ${parts.clock}（${PROMPT_TIME_ZONE}）`;
}

export function formatPromptDay(value = new Date()) {
  const parts = promptTimeParts(value);
  return parts ? `${parts.day} ${parts.weekday}` : "日期未知";
}

export function formatPromptClock(value = new Date()) {
  return promptTimeParts(value)?.clock || "时间未知";
}

export function formatPromptTimeline(messages, renderLine) {
  let previousDay = "";
  const lines = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const day = formatPromptDay(message?.createdAt);
    if (day !== previousDay) {
      lines.push(`[日期：${day}]`);
      previousDay = day;
    }
    const line = renderLine(message, formatPromptClock(message?.createdAt));
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

function promptTimeParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: PROMPT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  const weekdayIndex = dateAtShanghaiNoon(get("year"), get("month"), get("day")).getUTCDay();
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: ENGLISH_WEEKDAYS[weekdayIndex] || "",
    clock: `${get("hour")}:${get("minute")}`,
  };
}

export function timestampedText(text, createdAt, fallback = "") {
  const content = clean(text) || fallback;
  return `[发送时间：${formatPromptTime(createdAt)}]\n${content}`;
}

export function stripInternalTimeMetadata(value) {
  let text = typeof value === "string" ? value : "";
  const prefixes = [
    /^\s*(?:\*\*|__)?Kimi(?:\*\*|__)?\s*[：:]\s*(?:\*\*|__)?\s*/iu,
    /^\s*[【[](?:私聊|群聊|Kimi\s*私聊|LIVING ROOM(?:\s*群聊)?)[】\]]\s*/iu,
    /^\s*\[发送时间：[^\]\r\n]{1,160}\]\s*/u,
    /^\s*\[日期：\d{4}-\d{2}-\d{2}\s+(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\]\s*/u,
    /^\s*\[\d{2}:\d{2}\s+(?:私聊|群聊)\]\s*/u,
    /^\s*\[\d{4}-\d{2}-\d{2}\s+(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+\d{2}:\d{2}（Asia\/Shanghai）\]\s*/u,
    /^\s*(?:当前时间|发送时间)\s*[：:]\s*\d{4}-\d{2}-\d{2}\s+(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+\d{2}:\d{2}（Asia\/Shanghai）[。；]?\s*/u,
    /^\s*\[\d{4}-\d{2}-\d{2}\s+(?:星期[一二三四五六日天]\s+)?\d{2}:\d{2}(?::\d{2})?（Asia\/Shanghai，UTC\+08:00）\]\s*/u,
    /^\s*(?:当前时间|发送时间)\s*[：:]\s*\d{4}-\d{2}-\d{2}\s+(?:星期[一二三四五六日天]\s+)?\d{2}:\d{2}(?::\d{2})?（Asia\/Shanghai，UTC\+08:00）[。；]?\s*/u,
  ];
  for (let pass = 0; pass < prefixes.length; pass += 1) {
    for (const prefix of prefixes) text = text.replace(prefix, "");
  }
  return text.trimStart();
}

function dateAtShanghaiNoon(year, month, day) {
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 4));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
