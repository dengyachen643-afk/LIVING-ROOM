import path from "node:path";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";

const MIME_TO_EXTENSION = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

export async function saveIncomingImages(images, uploadDir, { maxFiles = 4, maxBytes = 6_000_000 } = {}) {
  const candidates = Array.isArray(images) ? images.slice(0, maxFiles) : [];
  if (!candidates.length) return [];
  await mkdir(uploadDir, { recursive: true });
  const saved = [];
  for (const candidate of candidates) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/u.exec(String(candidate?.dataUrl || ""));
    if (!match || !MIME_TO_EXTENSION.has(match[1])) throw httpError(400, "只支持 PNG、JPEG、WebP 和 GIF 图片");
    const bytes = Buffer.from(match[2].replace(/\s/gu, ""), "base64");
    if (!bytes.length || bytes.length > maxBytes) throw httpError(413, "每张图片不能超过 6 MB");
    if (!matchesSignature(bytes, match[1])) throw httpError(400, "图片内容与文件格式不一致");
    const filename = `${globalThis.crypto.randomUUID()}${MIME_TO_EXTENSION.get(match[1])}`;
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, bytes);
    saved.push({
      type: "image",
      name: clean(candidate?.name).slice(0, 180) || filename,
      mimeType: match[1],
      size: bytes.length,
      url: `/uploads/${filename}`,
      filePath,
      dataUrl: `data:${match[1]};base64,${bytes.toString("base64")}`,
    });
  }
  return saved;
}

export async function readUploadedImage(filePath, mimeType) {
  const bytes = await readFile(filePath);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

export async function saveRemoteImage(imageUrl, fetchImpl, uploadDir, { maxBytes = 12_000_000 } = {}) {
  let parsed;
  try { parsed = new URL(String(imageUrl || "")); } catch { throw httpError(400, "生成图片地址无效"); }
  if (parsed.protocol !== "https:") throw httpError(400, "生成图片地址必须使用 HTTPS");
  const response = await fetchImpl(parsed, { redirect: "follow" });
  if (!response.ok) throw new Error(`下载生成图片失败 (${response.status})`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw httpError(413, "生成图片文件过大");
  const mimeType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!MIME_TO_EXTENSION.has(mimeType)) throw httpError(400, "生成服务返回了不支持的图片格式");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw httpError(413, "生成图片文件过大");
  if (!matchesSignature(bytes, mimeType)) throw httpError(400, "生成服务返回的图片内容无效");
  await mkdir(uploadDir, { recursive: true });
  const filename = `${globalThis.crypto.randomUUID()}${MIME_TO_EXTENSION.get(mimeType)}`;
  const filePath = path.join(uploadDir, filename);
  await writeFile(filePath, bytes);
  return {
    type: "image",
    name: filename,
    mimeType,
    size: bytes.length,
    url: `/uploads/${filename}`,
    filePath,
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
  };
}

export function publicAttachments(images) {
  return (Array.isArray(images) ? images : []).map(({ type, name, mimeType, size, url }) => ({
    type, name, mimeType, size, url,
  }));
}

export async function removePublicUpload(url, uploadDir) {
  const filename = path.basename(String(url || ""));
  if (!filename || url !== `/uploads/${filename}`) return false;
  const root = `${path.resolve(uploadDir)}${path.sep}`;
  const target = path.resolve(uploadDir, filename);
  if (!target.startsWith(root)) return false;
  try {
    await unlink(target);
    await removeDerivedThumbnails(uploadDir, filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function removeDerivedThumbnails(uploadDir, filename) {
  const thumbnailDir = path.join(uploadDir, ".thumbs");
  let entries;
  try { entries = await readdir(thumbnailDir); }
  catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(entries
    .filter((entry) => entry.startsWith(`${filename}.`))
    .map((entry) => unlink(path.join(thumbnailDir, entry)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    })));
}

function matchesSignature(bytes, mimeType) {
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (mimeType === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  if (mimeType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
