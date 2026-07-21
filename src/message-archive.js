import path from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export class MessageArchive {
  constructor({ filePath = ":memory:" } = {}) {
    this.filePath = filePath === ":memory:" ? ":memory:" : path.resolve(filePath);
    this.db = null;
  }

  initialize() {
    if (this.db) return this;
    if (this.filePath !== ":memory:") mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.db = new DatabaseSync(this.filePath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        role TEXT NOT NULL,
        author TEXT NOT NULL,
        provider_id TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_time
        ON chat_messages(channel, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_time
        ON chat_messages(created_at DESC, id DESC);
    `);
    return this;
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  upsert(message) {
    this.initialize();
    if (!message?.id) return null;
    this.db.prepare(`INSERT INTO chat_messages
      (id, channel, role, author, provider_id, content, created_at, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        channel=excluded.channel,
        role=excluded.role,
        author=excluded.author,
        provider_id=excluded.provider_id,
        content=excluded.content,
        created_at=excluded.created_at,
        payload=excluded.payload`)
      .run(
        message.id,
        clean(message.channel) || "group",
        message.role === "assistant" ? "assistant" : "user",
        clean(message.author),
        clean(message.providerId),
        clean(message.content),
        validIso(message.createdAt),
        JSON.stringify(message),
      );
    return message;
  }

  import(messages) {
    this.initialize();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const message of Array.isArray(messages) ? messages : []) this.upsert(message);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  list({ channel = "", before = "", limit = 60 } = {}) {
    this.initialize();
    const capped = clampInt(limit, 1, 100, 60);
    const normalizedChannel = clean(channel).slice(0, 40);
    const normalizedBefore = before ? validIso(before) : "";
    let rows;
    if (normalizedChannel && normalizedBefore) {
      rows = this.db.prepare(`SELECT payload FROM chat_messages
        WHERE channel=? AND created_at<? ORDER BY created_at DESC, id DESC LIMIT ?`)
        .all(normalizedChannel, normalizedBefore, capped);
    } else if (normalizedChannel) {
      rows = this.db.prepare(`SELECT payload FROM chat_messages
        WHERE channel=? ORDER BY created_at DESC, id DESC LIMIT ?`).all(normalizedChannel, capped);
    } else if (normalizedBefore) {
      rows = this.db.prepare(`SELECT payload FROM chat_messages
        WHERE created_at<? ORDER BY created_at DESC, id DESC LIMIT ?`).all(normalizedBefore, capped);
    } else {
      rows = this.db.prepare("SELECT payload FROM chat_messages ORDER BY created_at DESC, id DESC LIMIT ?").all(capped);
    }
    const entries = rows.map(parsePayload).filter(Boolean).reverse();
    return {
      entries,
      nextCursor: rows.length === capped ? entries[0]?.createdAt || "" : "",
    };
  }

  search({ query = "", channel = "", member = "", limit = 50 } = {}) {
    this.initialize();
    const text = clean(query).slice(0, 200);
    const normalizedMember = normalizeMember(member);
    if (!text && !normalizedMember) return [];
    const capped = clampInt(limit, 1, 100, 50);
    const normalizedChannel = clean(channel).slice(0, 40);
    const clauses = [];
    const parameters = [];
    if (normalizedChannel) {
      clauses.push("channel=?");
      parameters.push(normalizedChannel);
    }
    if (text) {
      clauses.push("(content LIKE ? OR author LIKE ?)");
      const pattern = `%${text}%`;
      parameters.push(pattern, pattern);
    }
    if (normalizedMember) clauses.push(memberPredicate(normalizedMember));
    const rows = this.db.prepare(`SELECT payload FROM chat_messages
      WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...parameters, capped);
    return rows.map(parsePayload).filter(Boolean);
  }

  around(id, radius = 24) {
    this.initialize();
    const target = this.db.prepare("SELECT id, channel, created_at, payload FROM chat_messages WHERE id=?").get(clean(id));
    if (!target) return [];
    const capped = clampInt(radius, 1, 50, 24);
    const before = this.db.prepare(`SELECT payload FROM chat_messages
      WHERE channel=? AND (created_at<? OR (created_at=? AND id<?))
      ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(target.channel, target.created_at, target.created_at, target.id, capped)
      .map(parsePayload).filter(Boolean).reverse();
    const after = this.db.prepare(`SELECT payload FROM chat_messages
      WHERE channel=? AND (created_at>? OR (created_at=? AND id>?))
      ORDER BY created_at ASC, id ASC LIMIT ?`)
      .all(target.channel, target.created_at, target.created_at, target.id, capped)
      .map(parsePayload).filter(Boolean);
    return [...before, parsePayload(target), ...after].filter(Boolean);
  }

  clear(channel = "") {
    this.initialize();
    const normalizedChannel = clean(channel).slice(0, 40);
    return normalizedChannel
      ? this.db.prepare("DELETE FROM chat_messages WHERE channel=?").run(normalizedChannel).changes
      : this.db.prepare("DELETE FROM chat_messages").run().changes;
  }
}

function parsePayload(row) {
  try { return JSON.parse(row?.payload || ""); } catch { return null; }
}

function validIso(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeMember(value) {
  const member = clean(value).toLowerCase();
  return ["okra", "gen", "kimi", "glm", "k"].includes(member) ? member : "";
}

function memberPredicate(member) {
  if (member === "okra") return "role='user'";
  if (member === "gen") return "(provider_id IN ('openai','codex-cli') OR lower(author) IN ('gen','g老师','弦'))";
  if (member === "kimi") return "(provider_id='kimi' OR lower(author)='kimi')";
  if (member === "glm") return "(provider_id='glm' OR lower(author) IN ('shin','glm'))";
  return "(provider_id IN ('anthropic','claude-code') OR lower(author)='k')";
}

function clean(value) { return typeof value === "string" ? value.trim() : ""; }
