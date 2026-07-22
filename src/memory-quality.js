export const AUTO_MEMORY_MAX_CHARS = 180;
export const EXPLICIT_MEMORY_MAX_CHARS = 300;

const AUTO_MEMORY_SOURCES = new Set([
  "kimi-auto", "kimi-group-auto", "glm-auto", "glm-group-auto",
]);

export function normalizeAutoMemoryText(value, { explicit = false } = {}) {
  const text = clean(value).replace(/\s+/gu, " ");
  if (!text) return "";
  const limit = explicit ? EXPLICIT_MEMORY_MAX_CHARS : AUTO_MEMORY_MAX_CHARS;
  if ([...text].length > limit) return "";
  if (!explicit && (looksLikeProfileDump(text) || looksTransient(text))) return "";
  return text;
}

export function isLowQualityAutoMemory(memory) {
  const source = clean(memory?.source);
  if (!AUTO_MEMORY_SOURCES.has(source)) return false;
  const tags = Array.isArray(memory?.tags) ? memory.tags.map(clean) : [];
  if (tags.includes("自我设定")) return false;
  return !normalizeAutoMemoryText(memory?.text);
}

function looksLikeProfileDump(text) {
  if (/(?:基本信息|人物档案|个人档案|完整画像|综合画像|信息汇总)/u.test(text)) return true;
  const clauses = text.split(/[。；;]/u).map(clean).filter(Boolean);
  return [...text].length > 100 && clauses.length >= 4;
}

function looksTransient(text) {
  if (/(?:长期|固定|持续|以后一直|正式决定|稳定偏好)/u.test(text)) return false;
  const hasTemporaryTime = /(?:今天|明天|昨天|刚刚|刚才|这次|本轮|当前|目前|暂时|稍后|待会|近期|接下来)/u.test(text);
  const hasTaskStatus = /(?:计划|准备|打算|正在|已完成|完成了|修复|优化|调整|测试|处理|不处理|不碰|上线|迁移|改了|改完|解决了)/u.test(text);
  const hasTechnicalChore = /(?:去重|防复读|补丁|bug|服务器|部署|代码|接口|API|prompt|提示词|缓存|前端|后端|新功能)/iu.test(text);
  return (hasTemporaryTime && hasTaskStatus) || (hasTaskStatus && hasTechnicalChore);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
