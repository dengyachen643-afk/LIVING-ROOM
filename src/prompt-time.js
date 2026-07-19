const PROMPT_TIME_ZONE = "Asia/Shanghai";

export function formatPromptTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return "时间未知";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: PROMPT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}（${PROMPT_TIME_ZONE}，UTC+08:00）`;
}

export function timestampedText(text, createdAt, fallback = "") {
  const content = clean(text) || fallback;
  return `[发送时间：${formatPromptTime(createdAt)}]\n${content}`;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
