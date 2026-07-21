import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { MomentsStore } from "../src/moments-store.js";
import { RoundtableStore } from "../src/store.js";
import { createServer } from "../src/server.js";

test("MomentsStore keeps posts, images, comments, likes and persistent jobs", () => {
  const store = new MomentsStore({ filePath: ":memory:" });
  try {
    const moment = store.createMoment({
      id: "moment-1",
      authorId: "okra",
      content: "今晚的云很好看",
      media: [{ url: "/uploads/cloud.jpg", mimeType: "image/jpeg" }],
      createdAt: "2026-07-21T12:00:00.000Z",
    });
    assert.equal(moment.media[0].url, "/uploads/cloud.jpg");

    const comment = store.createComment({
      id: "comment-1", momentId: moment.id, authorId: "kimi", content: "像一封没寄出去的信。", generated: true,
    });
    assert.equal(comment.author_id, "kimi");
    store.setLike(moment.id, "gen", true);
    const hydrated = store.getMoment(moment.id);
    assert.equal(hydrated.comments[0].content, "像一封没寄出去的信。");
    assert.deepEqual(hydrated.likes.map((item) => item.actorId), ["gen"]);

    store.enqueueJob({ id: "job-1", type: "react", actorId: "gen", momentId: moment.id, runAt: "2026-07-21T12:01:00.000Z", dedupeKey: "react-once" });
    store.enqueueJob({ id: "job-2", type: "react", actorId: "gen", momentId: moment.id, runAt: "2026-07-21T12:01:00.000Z", dedupeKey: "react-once" });
    const job = store.claimDueJob("2026-07-21T12:02:00.000Z");
    assert.equal(job.id, "job-1");
    assert.equal(job.attempts, 1);
    assert.equal(store.claimDueJob("2026-07-21T12:02:00.000Z"), null);
  } finally { store.close(); }
});

test("MomentsStore returns incremental updates after a comment", () => {
  const store = new MomentsStore({ filePath: ":memory:" });
  try {
    const moment = store.createMoment({ id: "moment-2", authorId: "shin", content: "先留在这里。", createdAt: "2026-07-21T10:00:00.000Z" });
    const cursor = moment.updatedAt;
    store.createComment({ momentId: moment.id, authorId: "okra", content: "看到了", createdAt: "2026-07-21T10:01:00.000Z" });
    const updates = store.listMoments({ since: cursor });
    assert.equal(updates.entries.length, 1);
    assert.equal(updates.entries[0].comments.length, 1);
  } finally { store.close(); }
});

test("MomentsStore persists shared Moments settings", () => {
  const store = new MomentsStore({ filePath: ":memory:" });
  try {
    assert.equal(store.getSetting("cover_url"), "");
    assert.equal(store.setSetting("cover_url", "/uploads/cover.jpg"), "/uploads/cover.jpg");
    assert.equal(store.getSetting("cover_url"), "/uploads/cover.jpg");
    assert.equal(store.deleteSetting("cover_url"), true);
    assert.equal(store.getSetting("cover_url"), "");
  } finally { store.close(); }
});

test("moments HTTP API creates a post and updates its social thread", async () => {
  const momentsStore = new MomentsStore({ filePath: ":memory:" });
  const uploadDir = await mkdtemp(path.join(tmpdir(), "living-room-moments-"));
  const server = createServer({
    env: { MOMENTS_ENABLED: "false", PROACTIVE_ENABLED: "false", UPLOAD_DIR: uploadDir },
    providers: [],
    store: new RoundtableStore({ filePath: "" }),
    momentsStore,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/api/moments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "第一条朋友圈" }),
    }).then((response) => response.json());
    assert.equal(created.moment.authorId, "okra");

    const commented = await fetch(`${base}/api/moments/${created.moment.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "留在这里" }),
    }).then((response) => response.json());
    assert.equal(commented.moment.comments[0].authorId, "okra");

    const liked = await fetch(`${base}/api/moments/${created.moment.id}/like`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ liked: true }),
    }).then((response) => response.json());
    assert.equal(liked.moment.likes[0].actorId, "okra");

    const feed = await fetch(`${base}/api/moments`).then((response) => response.json());
    assert.equal(feed.entries[0].id, created.moment.id);

    const cover = await fetch(`${base}/api/moments/cover`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image: {
          name: "cover.png",
          dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X9yT5QAAAABJRU5ErkJggg==",
        },
      }),
    }).then((response) => response.json());
    assert.match(cover.coverUrl, /^\/uploads\/[A-Za-z0-9-]+\.png$/u);
    const feedWithCover = await fetch(`${base}/api/moments`).then((response) => response.json());
    assert.equal(feedWithCover.coverUrl, cover.coverUrl);

    const clientId = "client_moment_12345678";
    const firstRetryable = await fetch(`${base}/api/moments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: clientId, content: "立即上墙" }),
    }).then((response) => response.json());
    const repeated = await fetch(`${base}/api/moments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: clientId, content: "不会重复" }),
    }).then((response) => response.json());
    assert.equal(firstRetryable.moment.id, clientId);
    assert.equal(repeated.moment.id, clientId);
    assert.equal(repeated.moment.content, "立即上墙");

    const page = await fetch(`${base}/moments`).then((response) => response.text());
    assert.match(page, /朋友圈/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(uploadDir, { recursive: true, force: true });
  }
});
