import path from "node:path";
import { readFile } from "node:fs/promises";

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: npm run import:g-memory -- <G_TEACHER_MEMORY.md>");

const markdown = await readFile(path.resolve(filePath), "utf8");
const block = markdown.match(/```jsonl\s*([\s\S]*?)```/iu)?.[1];
if (!block) throw new Error("The markdown file does not contain a jsonl code block.");

const records = block.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line, index) => {
  try { return JSON.parse(line); }
  catch (error) { throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`); }
});

const baseUrl = (process.env.MEMORY_IMPORT_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`).replace(/\/+$/u, "");
const token = process.env.ROUNDTABLE_ACCESS_TOKEN || "";
let imported = 0;

for (const record of records) {
  const response = await fetch(`${baseUrl}/api/memories`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      text: record.text,
      namespace: "g",
      tags: [record.category, "gen"].filter(Boolean),
      importance: record.importance,
      source: "g-teacher-memory-import",
      metadata: {
        category: record.category || "",
        confidence: record.confidence ?? "",
        memoryUpdatedAt: record.updated_at || "",
        originalSource: record.source || "",
        importedFrom: path.basename(filePath),
      },
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(`Import failed at record ${imported + 1}: ${payload.error || response.status}`);
  }
  const payload = await response.json();
  if (payload?.memory?.vectorStatus !== "indexed") {
    throw new Error(`Memory ${payload?.memory?.id || imported + 1} was saved but not vectorized.`);
  }
  imported += 1;
  if (imported % 10 === 0 || imported === records.length) console.log(`Imported ${imported}/${records.length}`);
}

console.log(`G teacher memory import complete: ${imported} records.`);
