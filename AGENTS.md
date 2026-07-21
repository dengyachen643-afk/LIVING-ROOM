# LIVING ROOM repository guidance

LIVING ROOM is a self-hosted Node.js multi-model chat, memory and Moments application. Preserve the existing privacy boundaries and deterministic server-side controls when changing it.

## Non-negotiable boundaries

- Never commit `.env`, `.roundtable/`, SQLite files, API-key files, uploaded media, chat exports, memory exports, logs or local backups.
- Browser code must not receive provider API keys, memory-editor tokens or local filesystem paths.
- A member may read its own private channel plus the group channel; it must never receive another member's private channel.
- Long-term memories are namespace-scoped. Do not merge member namespaces merely to simplify a query.
- User corrections outrank recalled memory. Deletion requires explicit user intent.
- Group reply limits, deduplication and abort handling belong on the server, not only in prompts or the UI.
- Treat a dropped browser connection as different from a cancelled generation. Accepted work must be recoverable through status/sync APIs.

## Working conventions

- Use Node.js 22+ ESM and the existing native HTTP/frontend architecture unless a migration is explicitly requested.
- Preserve unrelated changes in a dirty worktree.
- Prefer small provider adapters and deterministic validation around model output.
- Keep static prompt rules before dynamic context; keep history and recalled memories bounded.
- Add or update tests for provider payloads, privacy boundaries, persistence and mobile interaction changes.
- Run `npm run check` and `npm test` before publishing.

Read the root `README.md` for architecture, deployment, RAG, provider-specific behavior and the recommended implementation order.
