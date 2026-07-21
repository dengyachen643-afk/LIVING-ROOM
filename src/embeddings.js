import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";

export const DEFAULT_EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

export class LocalEmbeddingService {
  constructor({ model = DEFAULT_EMBEDDING_MODEL, cacheDir = ".roundtable/models", remoteHost = process.env.HF_ENDPOINT } = {}) {
    this.model = clean(model) || DEFAULT_EMBEDDING_MODEL;
    this.cacheDir = path.resolve(clean(cacheDir) || ".roundtable/models");
    this.remoteHost = ensureSlash(clean(remoteHost) || "https://huggingface.co/");
    this.extractorPromise = null;
  }

  async embed(text) {
    const input = clean(text).slice(0, 4_000);
    if (!input) return [];
    const extractor = await this.getExtractor();
    const output = await extractor(input, { pooling: "mean", normalize: true });
    return Array.from(output.data || [], (value) => Number(Number(value).toFixed(6)));
  }

  async embedMany(texts, { batchSize = 32 } = {}) {
    const inputs = (Array.isArray(texts) ? texts : []).map((text) => clean(text).slice(0, 2_000));
    if (!inputs.length) return [];
    const extractor = await this.getExtractor();
    const vectors = [];
    const size = Math.max(1, Math.min(64, Number.parseInt(batchSize, 10) || 32));
    for (let index = 0; index < inputs.length; index += size) {
      const batch = inputs.slice(index, index + size);
      const output = await extractor(batch, { pooling: "mean", normalize: true });
      const rows = output.tolist();
      for (const row of rows) {
        vectors.push(Array.from(row || [], (value) => Number(Number(value).toFixed(6))));
      }
    }
    return vectors;
  }

  async getExtractor() {
    if (!this.extractorPromise) {
      env.cacheDir = this.cacheDir;
      env.remoteHost = this.remoteHost;
      this.extractorPromise = pipeline("feature-extraction", this.model, { dtype: "q8" });
    }
    return this.extractorPromise;
  }
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]) || 0;
    const b = Number(right[index]) || 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}
