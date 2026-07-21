export function normalizeQuote(value) {
  const text = truncateQuote(value?.text);
  if (!text) return null;
  return {
    messageId: clean(value?.messageId).slice(0, 120),
    author: normalizeQuoteAuthor(value?.author),
    text,
  };
}

export function quotePromptLine(value, speaker = "Okra") {
  const quote = normalizeQuote(value);
  if (!quote) return "";
  return `${normalizeQuoteAuthor(speaker)}引用了${quote.author}的一句话“${quote.text}”`;
}

export function messageQuoteLine(message) {
  const speaker = message?.role === "user" ? "Okra" : normalizeQuoteAuthor(message?.author);
  return quotePromptLine(message?.quote, speaker);
}

function truncateQuote(value) {
  const text = clean(value).replace(/\s+/gu, " ");
  return [...text].slice(0, 15).join("");
}

function normalizeQuoteAuthor(value) {
  const author = clean(value).slice(0, 80);
  if (!author || ["用户", "你", "okra"].includes(author.toLowerCase())) return "Okra";
  if (["GLM", "glm", "智谱"].includes(author)) return "Shin";
  if (["GPT", "ChatGPT", "G老师"].includes(author)) return "Gen";
  return author;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
