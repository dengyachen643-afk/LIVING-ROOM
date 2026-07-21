import path from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const MEMBER_IDS = new Set(["okra", "gen", "kimi", "shin", "k"]);
const JOB_STATUSES = new Set(["pending", "running", "done", "skipped", "failed"]);

export class MomentsStore {
  constructor({ filePath }) {
    this.filePath = filePath === ":memory:" ? ":memory:" : path.resolve(filePath || ".roundtable/moments.sqlite");
    this.db = null;
  }

  initialize() {
    if (this.db) return this;
    if (this.filePath !== ":memory:") mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.db = new DatabaseSync(this.filePath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS moments (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        context_note TEXT NOT NULL DEFAULT '',
        image_description TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_moments_created ON moments(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_moments_updated ON moments(updated_at DESC);

      CREATE TABLE IF NOT EXISTS moment_media (
        id TEXT PRIMARY KEY,
        moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_moment_media_parent ON moment_media(moment_id, sort_order);

      CREATE TABLE IF NOT EXISTS moment_comments (
        id TEXT PRIMARY KEY,
        moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        reply_to_comment_id TEXT NOT NULL DEFAULT '',
        generated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        deleted_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_moment_comments_parent ON moment_comments(moment_id, created_at);

      CREATE TABLE IF NOT EXISTS moment_reactions (
        moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL,
        reaction_type TEXT NOT NULL DEFAULT 'like',
        created_at TEXT NOT NULL,
        PRIMARY KEY(moment_id, actor_id, reaction_type)
      );
      CREATE INDEX IF NOT EXISTS idx_moment_reactions_parent ON moment_reactions(moment_id, created_at);

      CREATE TABLE IF NOT EXISTS moment_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        actor_id TEXT NOT NULL DEFAULT '',
        moment_id TEXT NOT NULL DEFAULT '',
        comment_id TEXT NOT NULL DEFAULT '',
        run_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL DEFAULT '{}',
        dedupe_key TEXT NOT NULL UNIQUE,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_moment_jobs_due ON moment_jobs(status, run_at);

      CREATE TABLE IF NOT EXISTS moment_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
    `);
    this.db.prepare("UPDATE moment_jobs SET status='pending', updated_at=? WHERE status='running'").run(nowIso());
    return this;
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  createMoment({ id = crypto.randomUUID(), authorId, content = "", contextNote = "", imageDescription = "", source = "user", media = [], createdAt = nowIso() } = {}) {
    this.initialize();
    const author = memberId(authorId);
    const text = clean(content).slice(0, 8_000);
    const normalizedMedia = normalizeMedia(media);
    if (!text && !normalizedMedia.length) throw httpError(400, "动态不能为空");
    const timestamp = iso(createdAt);
    this.transaction(() => {
      this.db.prepare(`INSERT INTO moments
        (id, author_id, content, context_note, image_description, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, author, text, clean(contextNote).slice(0, 4_000), clean(imageDescription).slice(0, 4_000), clean(source).slice(0, 40) || "user", timestamp, timestamp);
      const insertMedia = this.db.prepare(`INSERT INTO moment_media
        (id, moment_id, url, mime_type, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
      normalizedMedia.forEach((item, index) => insertMedia.run(
        item.id || crypto.randomUUID(), id, item.url, item.mimeType, index, timestamp,
      ));
    });
    return this.getMoment(id);
  }

  updateMomentContext(id, { contextNote, imageDescription } = {}) {
    this.initialize();
    const current = this.db.prepare("SELECT id FROM moments WHERE id=? AND deleted_at=''").get(clean(id));
    if (!current) return null;
    const timestamp = nowIso();
    if (contextNote !== undefined) this.db.prepare("UPDATE moments SET context_note=?, updated_at=? WHERE id=?")
      .run(clean(contextNote).slice(0, 4_000), timestamp, id);
    if (imageDescription !== undefined) this.db.prepare("UPDATE moments SET image_description=?, updated_at=? WHERE id=?")
      .run(clean(imageDescription).slice(0, 4_000), timestamp, id);
    return this.getMoment(id);
  }

  getMoment(id) {
    this.initialize();
    const row = this.db.prepare("SELECT * FROM moments WHERE id=? AND deleted_at=''").get(clean(id));
    return row ? this.hydrate(row) : null;
  }

  listMoments({ cursor = "", limit = 20, since = "" } = {}) {
    this.initialize();
    const safeLimit = clampInt(limit, 1, 50, 20);
    let rows;
    if (clean(since)) {
      rows = this.db.prepare(`SELECT * FROM moments WHERE deleted_at='' AND updated_at>?
        ORDER BY updated_at ASC LIMIT ?`).all(iso(since), safeLimit);
    } else if (clean(cursor)) {
      rows = this.db.prepare(`SELECT * FROM moments WHERE deleted_at='' AND created_at<?
        ORDER BY created_at DESC LIMIT ?`).all(iso(cursor), safeLimit);
    } else {
      rows = this.db.prepare(`SELECT * FROM moments WHERE deleted_at=''
        ORDER BY created_at DESC LIMIT ?`).all(safeLimit);
    }
    const entries = rows.map((row) => this.hydrate(row));
    return {
      entries,
      nextCursor: !since && entries.length === safeLimit ? entries.at(-1)?.createdAt || "" : "",
      syncCursor: entries.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, clean(since)),
    };
  }

  deleteMoment(id, authorId = "okra") {
    this.initialize();
    const result = this.db.prepare("UPDATE moments SET deleted_at=?, updated_at=? WHERE id=? AND author_id=? AND deleted_at='' ")
      .run(nowIso(), nowIso(), clean(id), memberId(authorId));
    return result.changes > 0;
  }

  createComment({ id = crypto.randomUUID(), momentId, authorId, content, replyToCommentId = "", generated = false, createdAt = nowIso() } = {}) {
    this.initialize();
    const moment = this.db.prepare("SELECT id FROM moments WHERE id=? AND deleted_at=''").get(clean(momentId));
    if (!moment) throw httpError(404, "动态不存在");
    const text = clean(content).slice(0, 4_000);
    if (!text) throw httpError(400, "评论不能为空");
    const replyId = clean(replyToCommentId);
    if (replyId) {
      const parent = this.db.prepare("SELECT id FROM moment_comments WHERE id=? AND moment_id=? AND deleted_at='' ").get(replyId, momentId);
      if (!parent) throw httpError(400, "回复的评论不存在");
    }
    const timestamp = iso(createdAt);
    this.transaction(() => {
      this.db.prepare(`INSERT INTO moment_comments
        (id, moment_id, author_id, content, reply_to_comment_id, generated, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, momentId, memberId(authorId), text, replyId, generated ? 1 : 0, timestamp);
      this.touch(momentId, timestamp);
    });
    return this.db.prepare("SELECT * FROM moment_comments WHERE id=?").get(id);
  }

  setLike(momentId, actorId, liked = true) {
    this.initialize();
    const id = clean(momentId);
    if (!this.db.prepare("SELECT id FROM moments WHERE id=? AND deleted_at=''").get(id)) throw httpError(404, "动态不存在");
    const actor = memberId(actorId);
    const timestamp = nowIso();
    this.transaction(() => {
      if (liked) this.db.prepare(`INSERT INTO moment_reactions
        (moment_id, actor_id, reaction_type, created_at) VALUES (?, ?, 'like', ?)
        ON CONFLICT(moment_id, actor_id, reaction_type) DO NOTHING`).run(id, actor, timestamp);
      else this.db.prepare("DELETE FROM moment_reactions WHERE moment_id=? AND actor_id=? AND reaction_type='like'").run(id, actor);
      this.touch(id, timestamp);
    });
    return this.getMoment(id);
  }

  getSetting(key) {
    this.initialize();
    return clean(this.db.prepare("SELECT value FROM moment_settings WHERE key=?").get(clean(key))?.value);
  }

  setSetting(key, value) {
    this.initialize();
    const settingKey = clean(key).slice(0, 80);
    const settingValue = clean(value).slice(0, 1_000);
    if (!settingKey) throw httpError(400, "设置名称不能为空");
    this.db.prepare(`INSERT INTO moment_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(settingKey, settingValue, nowIso());
    return settingValue;
  }

  deleteSetting(key) {
    this.initialize();
    return this.db.prepare("DELETE FROM moment_settings WHERE key=?").run(clean(key)).changes > 0;
  }

  enqueueJob({ id = crypto.randomUUID(), type, actorId = "", momentId = "", commentId = "", runAt = nowIso(), payload = {}, dedupeKey, status = "pending" } = {}) {
    this.initialize();
    const key = clean(dedupeKey) || `${clean(type)}:${clean(actorId)}:${clean(momentId)}:${clean(commentId)}:${id}`;
    const timestamp = nowIso();
    const normalizedStatus = JOB_STATUSES.has(status) ? status : "pending";
    this.db.prepare(`INSERT INTO moment_jobs
      (id, type, actor_id, moment_id, comment_id, run_at, status, payload, dedupe_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING`)
      .run(id, clean(type).slice(0, 50), clean(actorId), clean(momentId), clean(commentId), iso(runAt), normalizedStatus, JSON.stringify(payload || {}), key, timestamp, timestamp);
    return this.db.prepare("SELECT * FROM moment_jobs WHERE dedupe_key=?").get(key);
  }

  claimDueJob(at = nowIso()) {
    this.initialize();
    let claimed = null;
    this.transaction(() => {
      const job = this.db.prepare(`SELECT * FROM moment_jobs WHERE status='pending' AND run_at<=?
        ORDER BY run_at ASC LIMIT 1`).get(iso(at));
      if (!job) return;
      const result = this.db.prepare("UPDATE moment_jobs SET status='running', attempts=attempts+1, updated_at=? WHERE id=? AND status='pending'")
        .run(nowIso(), job.id);
      if (result.changes) claimed = this.db.prepare("SELECT * FROM moment_jobs WHERE id=?").get(job.id);
    });
    return claimed ? publicJob(claimed) : null;
  }

  finishJob(id, status = "done", error = "") {
    this.initialize();
    const normalized = JOB_STATUSES.has(status) ? status : "done";
    this.db.prepare("UPDATE moment_jobs SET status=?, last_error=?, updated_at=? WHERE id=?")
      .run(normalized, clean(error).slice(0, 1_000), nowIso(), clean(id));
  }

  retryJob(id, runAt, error = "") {
    this.initialize();
    this.db.prepare("UPDATE moment_jobs SET status='pending', run_at=?, last_error=?, updated_at=? WHERE id=?")
      .run(iso(runAt), clean(error).slice(0, 1_000), nowIso(), clean(id));
  }

  countAiCommentsSinceUser(momentId) {
    this.initialize();
    const lastUser = this.db.prepare(`SELECT created_at FROM moment_comments
      WHERE moment_id=? AND author_id='okra' AND deleted_at='' ORDER BY created_at DESC LIMIT 1`).get(momentId)?.created_at || "";
    return Number(this.db.prepare(`SELECT COUNT(*) AS total FROM moment_comments
      WHERE moment_id=? AND author_id!='okra' AND generated=1 AND deleted_at='' AND created_at>?`).get(momentId, lastUser)?.total || 0);
  }

  countActorComments(momentId, actorId) {
    this.initialize();
    return Number(this.db.prepare(`SELECT COUNT(*) AS total FROM moment_comments
      WHERE moment_id=? AND author_id=? AND deleted_at=''`).get(momentId, memberId(actorId))?.total || 0);
  }

  countActorActionsToday(actorId, datePrefix) {
    this.initialize();
    const actor = memberId(actorId);
    const comments = Number(this.db.prepare(`SELECT COUNT(*) AS total FROM moment_comments
      WHERE author_id=? AND generated=1 AND created_at LIKE ?`).get(actor, `${clean(datePrefix)}%`)?.total || 0);
    const posts = Number(this.db.prepare(`SELECT COUNT(*) AS total FROM moments
      WHERE author_id=? AND source='scheduled' AND created_at LIKE ? AND deleted_at=''`).get(actor, `${clean(datePrefix)}%`)?.total || 0);
    return comments + posts;
  }

  countActorImagePostsToday(actorId, datePrefix) {
    this.initialize();
    return Number(this.db.prepare(`SELECT COUNT(DISTINCT moments.id) AS total
      FROM moments
      INNER JOIN moment_media ON moment_media.moment_id=moments.id
      WHERE moments.author_id=? AND moments.source='scheduled'
        AND moments.created_at LIKE ? AND moments.deleted_at=''`)
      .get(memberId(actorId), `${clean(datePrefix)}%`)?.total || 0);
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  hydrate(row) {
    const media = this.db.prepare("SELECT id, url, mime_type, sort_order FROM moment_media WHERE moment_id=? ORDER BY sort_order").all(row.id)
      .map((item) => ({ id: item.id, url: item.url, mimeType: item.mime_type }));
    const rawComments = this.db.prepare(`SELECT id, author_id, content, reply_to_comment_id, generated, created_at
      FROM moment_comments WHERE moment_id=? AND deleted_at='' ORDER BY created_at`).all(row.id);
    const authors = new Map(rawComments.map((item) => [item.id, item.author_id]));
    const comments = rawComments.map((item) => ({
      id: item.id,
      authorId: item.author_id,
      content: item.content,
      replyToCommentId: item.reply_to_comment_id,
      replyToAuthorId: authors.get(item.reply_to_comment_id) || "",
      generated: Boolean(item.generated),
      createdAt: item.created_at,
    }));
    const likes = this.db.prepare(`SELECT actor_id, created_at FROM moment_reactions
      WHERE moment_id=? AND reaction_type='like' ORDER BY created_at`).all(row.id)
      .map((item) => ({ actorId: item.actor_id, createdAt: item.created_at }));
    return {
      id: row.id,
      authorId: row.author_id,
      content: row.content,
      contextNote: row.context_note,
      imageDescription: row.image_description,
      source: row.source,
      media,
      comments,
      likes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  touch(momentId, timestamp = nowIso()) {
    this.db.prepare("UPDATE moments SET updated_at=? WHERE id=?").run(timestamp, momentId);
  }
}

function publicJob(row) {
  let payload = {};
  try { payload = JSON.parse(row.payload || "{}"); } catch { /* ignore invalid legacy payload */ }
  return {
    id: row.id,
    type: row.type,
    actorId: row.actor_id,
    momentId: row.moment_id,
    commentId: row.comment_id,
    runAt: row.run_at,
    status: row.status,
    attempts: Number(row.attempts || 0),
    payload,
    dedupeKey: row.dedupe_key,
  };
}

function normalizeMedia(media) {
  return (Array.isArray(media) ? media : []).slice(0, 4).map((item) => ({
    id: clean(item?.id),
    url: clean(item?.url),
    mimeType: clean(item?.mimeType) || "image/jpeg",
  })).filter((item) => /^\/uploads\/[A-Za-z0-9.-]+$/u.test(item.url));
}

function memberId(value) {
  const normalized = clean(value).toLowerCase();
  if (!MEMBER_IDS.has(normalized)) throw httpError(400, "未知的朋友圈成员");
  return normalized;
}

function iso(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw httpError(400, "时间格式无效");
  return parsed.toISOString();
}

function nowIso() { return new Date().toISOString(); }
function clean(value) { return typeof value === "string" ? value.trim() : ""; }
function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
