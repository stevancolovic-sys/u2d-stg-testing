// Up2Data API Tester — Worker.
//
// Two jobs only: serve the static UI, and act as a sink for webhook
// callbacks. API traffic never passes through here — the browser talks to
// api.uptodata.io directly, so the API key and JWT stay client-side.
//
// Callbacks live in a Durable Object per hook id, backed by SQLite. A DO
// needs no resource created ahead of deploy, which keeps `wrangler deploy`
// and a dashboard repo import equally one-step.

import {
  isAllowed, signSession, verifySession, parseCookies, cookie, clearCookie,
  decodeIdToken, authUrl, randomToken,
  SESSION_COOKIE, STATE_COOKIE, SESSION_SECONDS, GOOGLE_TOKEN,
} from './auth.js'

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

// Saved links live in one Durable Object shared by everyone who opens the
// console, so the list is the same from any device.
export class LinkStore {
  constructor(ctx) {
    this.ctx = ctx
    this.sql = ctx.storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS links (
      key TEXT PRIMARY KEY,
      id TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT,
      label TEXT NOT NULL,
      tags TEXT NOT NULL,
      created_ms INTEGER NOT NULL
    )`)
  }

  list() {
    return this.sql
      .exec('SELECT * FROM links ORDER BY created_ms DESC')
      .toArray()
      .map((row) => ({
        id: row.id,
        url: row.url,
        type: row.type,
        label: row.label,
        tags: JSON.parse(row.tags),
        createdAt: new Date(row.created_ms).toISOString(),
      }))
  }

  // Saving the same link twice updates it rather than making a duplicate:
  // the client sends the key it derived, so the rule lives in one place.
  save(links) {
    const now = Date.now()
    for (const link of links) {
      if (!link || !link.key || !link.url) continue
      this.sql.exec(
        `INSERT INTO links (key, id, url, type, label, tags, created_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           url = excluded.url, type = excluded.type,
           label = excluded.label, tags = excluded.tags`,
        link.key,
        link.id || crypto.randomUUID().slice(0, 12),
        link.url,
        link.type || null,
        link.label || link.url,
        JSON.stringify(Array.isArray(link.tags) ? link.tags : []),
        now
      )
    }
  }

  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === 'GET') return json({ links: this.list() })

    if (request.method === 'POST') {
      const body = await request.json().catch(() => null)
      const links = Array.isArray(body) ? body : body ? [body] : []
      this.save(links)
      return json({ saved: links.length, links: this.list() })
    }

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id')
      if (id) this.sql.exec('DELETE FROM links WHERE id = ?', id)
      else this.sql.exec('DELETE FROM links')
      return json({ links: this.list() })
    }

    return json({ error: 'Not found' }, 404)
  }
}

const DEFAULT_DOMAIN = 'totema.co'

const page = (title, body, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#141820; color:#d6dce4;
         font:400 15px/1.6 'IBM Plex Sans',system-ui,sans-serif }
  .card { width:min(520px,90vw); padding:36px; border:1px solid #2e3847;
          border-radius:6px; background:#1a212b }
  h1 { margin:0 0 10px; font-size:21px; font-weight:500 }
  p { margin:0 0 16px; color:#7e8a9a; font-size:14px }
  code { font-family:'IBM Plex Mono',ui-monospace,monospace; font-size:12.5px;
         color:#c8964a; word-break:break-all }
  a.btn { display:inline-block; padding:11px 22px; border-radius:4px;
          background:#c8964a; color:#17120a; font-weight:600; text-decoration:none }
  ol { color:#7e8a9a; font-size:13.5px; padding-left:20px }
  li { margin-bottom:8px }
</style>
<div class="card">${body}</div>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
  )

const authConfig = (env) => ({
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  secret: env.SESSION_SECRET,
  domain: env.ALLOWED_DOMAIN || DEFAULT_DOMAIN,
  ready: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET),
})

// Sign-in is refused until it is configured, rather than quietly letting
// everyone in — a gate nobody set up must not look like a gate that passed.
const setupPage = (url) =>
  page(
    'Sign-in not configured',
    `<h1>Sign-in is not set up yet</h1>
     <p>This console is closed until Google sign-in is configured. In the Worker's
        settings add three encrypted variables:</p>
     <ol>
       <li><code>GOOGLE_CLIENT_ID</code></li>
       <li><code>GOOGLE_CLIENT_SECRET</code></li>
       <li><code>SESSION_SECRET</code> — any long random string</li>
     </ol>
     <p>The OAuth client's authorised redirect URI must be exactly:<br>
        <code>${url.origin}/auth/callback</code></p>`,
    503
  )

async function handleAuth(request, env, url, parts) {
  const config = authConfig(env)
  const redirectUri = `${url.origin}/auth/callback`

  if (parts[1] === 'logout') {
    return new Response(null, {
      status: 302,
      headers: { location: '/', 'set-cookie': clearCookie(SESSION_COOKIE) },
    })
  }

  if (!config.ready) return setupPage(url)

  if (parts[1] === 'login') {
    const state = randomToken()
    return new Response(null, {
      status: 302,
      headers: {
        location: authUrl({ clientId: config.clientId, redirectUri, state, domain: config.domain }),
        'set-cookie': cookie(STATE_COOKIE, state, { maxAge: 600 }),
      },
    })
  }

  if (parts[1] === 'callback') {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const expected = parseCookies(request.headers.get('cookie'))[STATE_COOKIE]

    // Without this, a link could sign you in as somebody else's account.
    if (!code || !state || !expected || state !== expected) {
      return page('Sign-in failed', `<h1>Sign-in could not be completed</h1>
        <p>The request did not match the one that started it. Start again.</p>
        <p><a class="btn" href="/auth/login">Try again</a></p>`, 400)
    }

    const token = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    const payload = await token.json().catch(() => null)
    const claims = decodeIdToken(payload && payload.id_token)

    if (!claims) {
      return page('Sign-in failed', `<h1>Google did not return an identity</h1>
        <p><a class="btn" href="/auth/login">Try again</a></p>`, 502)
    }

    if (!isAllowed(claims, config.domain)) {
      return new Response(
        `<!doctype html><meta charset="utf-8"><title>No access</title>
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141820;color:#d6dce4;font:400 15px/1.6 'IBM Plex Sans',system-ui,sans-serif}.card{width:min(520px,90vw);padding:36px;border:1px solid #2e3847;border-radius:6px;background:#1a212b}h1{margin:0 0 10px;font-size:21px;font-weight:500}p{margin:0 0 16px;color:#7e8a9a;font-size:14px}a{color:#c8964a}</style>
<div class="card"><h1>That account cannot use this console</h1>
<p>Signed in as ${String(claims.email || 'an unknown account').replace(/[<>&]/g, '')}, which is not a verified @${config.domain} address.</p>
<p><a href="/auth/login">Use a different account</a></p></div>`,
        { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': clearCookie(STATE_COOKIE) } }
      )
    }

    const session = await signSession(
      { email: claims.email, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS },
      config.secret
    )
    const headers = new Headers({ location: '/' })
    headers.append('set-cookie', cookie(SESSION_COOKIE, session))
    headers.append('set-cookie', clearCookie(STATE_COOKIE))
    return new Response(null, { status: 302, headers })
  }

  if (parts[1] === 'me') {
    const session = await verifySession(
      parseCookies(request.headers.get('cookie'))[SESSION_COOKIE],
      config.secret
    )
    return json(session ? { email: session.email } : { email: null }, session ? 200 : 401)
  }

  return json({ error: 'Not found' }, 404)
}

// Returns a response when the caller may not pass, and null when they may.
async function gate(request, env, url) {
  const config = authConfig(env)
  if (!config.ready) return setupPage(url)

  const session = await verifySession(
    parseCookies(request.headers.get('cookie'))[SESSION_COOKIE],
    config.secret
  )
  if (session) return null

  return page(
    'Sign in',
    `<h1>Up2Data console</h1>
     <p>Internal tool. Sign in with your @${config.domain} Google account.</p>
     <p><a class="btn" href="/auth/login">Sign in with Google</a></p>`,
    401
  )
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

    // --- public: webhook callbacks. uptodata cannot sign in to Google, and a
    // redirect would push every delivery into its retry schedule and then drop
    // it. Only POSTs are public — a browser GET is gated below.
    if (parts[0] === 'hook' && parts[1] && request.method === 'POST' && !parts[2]) {
      return store(parts[1])
    }
    if (request.method === 'POST' && parts[0] !== 'auth' && parts[0] !== 'links') {
      return store(DEFAULT_HOOK)
    }

    // --- public: signing in
    if (parts[0] === 'auth') return handleAuth(request, env, url, parts)

    // --- everything past here needs a session
    const refused = await gate(request, env, url)
    if (refused) return refused

    if (parts[0] === 'links' && !parts[1]) {
      const stub = env.LINKS.get(env.LINKS.idFromName('links'))
      return stub.fetch(
        new Request(`https://do/${url.search}`, {
          method: request.method,
          headers: request.headers,
          body: request.method === 'GET' || request.method === 'DELETE' ? undefined : request.body,
        })
      )
    }

    if (parts[0] === 'hook' && parts[1]) {
      const id = parts[1]
      const stub = env.HOOKS.get(env.HOOKS.idFromName(id))

      if (parts[2] && parts[2] !== 'events') return json({ error: 'Not found' }, 404)

      const inner = parts[2] === 'events' ? 'https://do/events' : 'https://do/'
      return stub.fetch(new Request(inner, { method: request.method }))
    }

    if (env.ASSETS) return env.ASSETS.fetch(request)
    return json({ error: 'Not found' }, 404)
  },
}
