// Up2Data API Tester — Worker.
//
// Two jobs only: serve the static UI, and act as a sink for webhook
// callbacks. API traffic never passes through here — the browser talks to
// api.uptodata.io directly, so the API key and JWT stay client-side.
//
// Callbacks live in a Durable Object per hook id, backed by SQLite. A DO
// needs no resource created ahead of deploy, which keeps `wrangler deploy`
// and a dashboard repo import equally one-step.

const RETENTION_MS = 24 * 60 * 60 * 1000
const MAX_EVENTS = 200

// A webhook pointed at the bare origin is the obvious thing to configure, so
// it has to work: a POST anywhere outside /hook/ lands in this bucket rather
// than in a 405. Answering non-2xx would push the delivery into the API's
// retry schedule and then drop it.
const DEFAULT_HOOK = 'default'

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

export class HookStore {
  constructor(ctx) {
    this.ctx = ctx
    this.sql = ctx.storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      received_at TEXT NOT NULL,
      created_ms INTEGER NOT NULL,
      headers TEXT NOT NULL,
      body TEXT,
      raw TEXT NOT NULL
    )`)
  }

  prune(now) {
    this.sql.exec('DELETE FROM events WHERE created_ms < ?', now - RETENTION_MS)
    this.sql.exec(
      'DELETE FROM events WHERE rowid NOT IN (SELECT rowid FROM events ORDER BY rowid DESC LIMIT ?)',
      MAX_EVENTS
    )
  }

  async store(request) {
    const raw = await request.text()
    let body = null
    try {
      body = JSON.parse(raw)
    } catch {
      body = null
    }

    const now = Date.now()
    this.sql.exec(
      'INSERT INTO events (id, received_at, created_ms, headers, body, raw) VALUES (?, ?, ?, ?, ?, ?)',
      `${now}-${crypto.randomUUID().slice(0, 8)}`,
      new Date(now).toISOString(),
      now,
      JSON.stringify(Object.fromEntries(request.headers)),
      body === null ? null : JSON.stringify(body),
      raw
    )
    this.prune(now)
  }

  list() {
    // Ordered by rowid, not by timestamp: a burst of callbacks can share a
    // millisecond, and insertion order is the only account of what arrived
    // first that does not depend on clock resolution.
    const rows = this.sql.exec('SELECT * FROM events ORDER BY rowid DESC').toArray()
    return rows.map((row) => ({
      id: row.id,
      receivedAt: row.received_at,
      headers: JSON.parse(row.headers),
      body: row.body === null ? null : JSON.parse(row.body),
      raw: row.raw,
    }))
  }

  async fetch(request) {
    const { pathname } = new URL(request.url)

    if (request.method === 'POST' && pathname === '/') {
      await this.store(request)
      return json({ received: true })
    }
    if (request.method === 'GET' && pathname === '/events') {
      return json({ events: this.list() })
    }
    if (request.method === 'DELETE' && pathname === '/') {
      this.sql.exec('DELETE FROM events')
      return json({ cleared: true })
    }
    return json({ error: 'Not found' }, 404)
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    // Always answer 200 to a callback, even if storage fails. A non-2xx puts
    // the delivery into the API's retry schedule (10min, 1h, 8h, 24h) and
    // then abandons it.
    const store = async (id) => {
      const stub = env.HOOKS.get(env.HOOKS.idFromName(id))
      try {
        return await stub.fetch(
          new Request('https://do/', {
            method: 'POST',
            headers: request.headers,
            body: request.body,
          })
        )
      } catch (err) {
        console.error('hook store failed', err)
        return json({ received: false })
      }
    }

    if (parts[0] === 'hook' && parts[1]) {
      const id = parts[1]
      const stub = env.HOOKS.get(env.HOOKS.idFromName(id))

      if (parts[2] && parts[2] !== 'events') return json({ error: 'Not found' }, 404)
      if (request.method === 'POST' && !parts[2]) return store(id)

      const inner = parts[2] === 'events' ? 'https://do/events' : 'https://do/'
      return stub.fetch(new Request(inner, { method: request.method }))
    }

    // A webhook configured against the origin itself, or any other path.
    if (request.method === 'POST') return store(DEFAULT_HOOK)

    if (env.ASSETS) return env.ASSETS.fetch(request)
    return json({ error: 'Not found' }, 404)
  },
}
