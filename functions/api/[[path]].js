// Family Budget API: a tiny last-write-wins sync store on D1.
//   GET  /api/me              -> who is signed in + household names
//   GET  /api/sync?since=REV  -> records changed after REV (max 1000 per page)
//   POST /api/sync            -> { changes: [{id, kind, data, mtime, deleted}] }
//   GET  /api/export          -> every record (backup)
import { json } from "./_middleware.js";

const KINDS = new Set(["cat", "tx", "bill", "goal", "settings"]);
const ID = /^[A-Za-z0-9_-]{3,48}$/;
let ready = false;

async function init(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, mtime INTEGER NOT NULL,
      author TEXT, deleted INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL)`),
    db.prepare("CREATE INDEX IF NOT EXISTS records_rev ON records(rev)"),
  ]);
  ready = true;
}
const row = (x) => ({ id: x.id, kind: x.kind, data: JSON.parse(x.data), mtime: x.mtime, author: x.author, deleted: x.deleted, rev: x.rev });

export async function onRequest(ctx) {
  const { request, env, data } = ctx;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  if (!env.DB) return json({ error: "no_database_binding" }, 500);
  await init(env.DB);
  const m = request.method;

  if (path === "me" && m === "GET") return json({ email: data.email, name: data.name, people: data.people, time: Date.now() });

  if (path === "sync" && m === "GET") {
    const since = Math.max(0, parseInt(url.searchParams.get("since") || "0", 10) || 0);
    const r = await env.DB.prepare("SELECT * FROM records WHERE rev > ?1 ORDER BY rev LIMIT 1000").bind(since).all();
    const rows = r.results || [];
    return json({ rev: rows.length ? rows[rows.length - 1].rev : since, more: rows.length === 1000, records: rows.map(row), time: Date.now() });
  }

  if (path === "sync" && m === "POST") {
    if (+(request.headers.get("content-length") || 0) > 1_000_000) return json({ error: "too_large" }, 413);
    let body;
    try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
    const changes = Array.isArray(body && body.changes) ? body.changes : null;
    if (!changes || changes.length > 500) return json({ error: "bad_changes" }, 400);
    const maxT = Date.now() + 5 * 60e3, stmts = [];
    for (const c of changes) {
      if (!c || !ID.test(c.id || "") || !KINDS.has(c.kind)) return json({ error: "bad_record", id: c && c.id }, 400);
      const d = JSON.stringify(c.data == null ? {} : c.data);
      if (d.length > 8000) return json({ error: "record_too_large", id: c.id }, 400);
      const mt = Math.min(maxT, Math.max(0, Math.floor(+c.mtime || 0)));
      stmts.push(env.DB.prepare(
        `INSERT INTO records (id, kind, data, mtime, author, deleted, rev)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT COALESCE(MAX(rev), 0) + 1 FROM records))
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, data = excluded.data, mtime = excluded.mtime,
           author = excluded.author, deleted = excluded.deleted, rev = excluded.rev
         WHERE excluded.mtime >= records.mtime`
      ).bind(c.id, c.kind, d, mt, data.name, c.deleted ? 1 : 0));
    }
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    return json({ ok: true, applied: stmts.length });
  }

  if (path === "export" && m === "GET") {
    const r = await env.DB.prepare("SELECT * FROM records ORDER BY rev").all();
    return json({ exportedAt: new Date().toISOString(), by: data.name, records: (r.results || []).map(row) });
  }

  return json({ error: "not_found" }, 404);
}
