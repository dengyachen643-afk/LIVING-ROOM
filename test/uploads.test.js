import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";
import { publicAttachments, saveIncomingImages } from "../src/uploads.js";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("image uploads are validated, stored, and exposed without local paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "roundtable-images-"));
  try {
    const saved = await saveIncomingImages([{ name: "pixel.png", dataUrl: `data:image/png;base64,${ONE_PIXEL_PNG}` }], directory);
    assert.equal(saved.length, 1);
    await access(saved[0].filePath);
    const visible = publicAttachments(saved);
    assert.equal(visible[0].name, "pixel.png");
    assert.match(visible[0].url, /^\/uploads\/.+\.png$/u);
    assert.equal("filePath" in visible[0], false);
    assert.equal("dataUrl" in visible[0], false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("image uploads reject disguised file contents", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "roundtable-images-"));
  try {
    await assert.rejects(
      () => saveIncomingImages([{ name: "fake.png", dataUrl: "data:image/png;base64,aGVsbG8=" }], directory),
      /文件格式不一致/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
