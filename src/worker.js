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

// Two APIs, two deployments each. A key is issued for exactly one of the four,
// so they are stored apart — a staging key sent to production is refused, and
// a legacy key is meaningless to v1.
const API_BASES = {
  legacy: {
    staging: 'https://api.staging.uptodata.io/api',
    production: 'https://api.uptodata.io/api',
  },
  v1: {
    staging: 'https://api.staging.uptodata.io/v1',
    production: 'https://api.uptodata.io/v1',
  },
}

// Reading the key out of the store on every proxied call turned one API
// request into two, and a sustained load test then spent the Durable Objects
// free-tier allowance on key lookups rather than on the API under test. A key
// changes rarely, so an isolate may hold one briefly. The window is short and
// a save or removal clears it, so a replaced key cannot go on being used.
const KEY_CACHE = new Map()
const KEY_CACHE_MS = 60_000

const cacheSlot = (email, api, environment) => `${email}\u0000${api}\u0000${environment}`

function forgetCachedKeys(email) {
  for (const slot of KEY_CACHE.keys()) {
    if (slot.startsWith(`${email}\u0000`)) KEY_CACHE.delete(slot)
  }
}

async function apiKeyFor(env, email, api, environment) {
  const slot = cacheSlot(email, api, environment)
  const hit = KEY_CACHE.get(slot)
  if (hit && hit.until > Date.now()) return { apiKey: hit.apiKey, status: 200 }

  const stub = env.KEYS.get(env.KEYS.idFromName(email))
  const reply = await stub.fetch(
    new Request('https://do/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api, environment }),
    })
  )
  const body = await reply.json().catch(() => null)
  const apiKey = body && body.apiKey
  // Only a hit is worth keeping: caching "no key" would outlast the save.
  if (reply.ok && apiKey) KEY_CACHE.set(slot, { apiKey, until: Date.now() + KEY_CACHE_MS })
  return { apiKey, status: reply.status, error: body && body.error }
}

const APIS = Object.keys(API_BASES)
const ENVIRONMENTS = Object.keys(API_BASES.legacy)
const slotOf = (api, environment) => `${api}:${environment}`
const baseFor = (api, environment) => (API_BASES[api] || {})[environment] || null

// Enough to recognise a key, not enough to use one.
const hintOf = (key) => {
  const k = String(key || '')
  return k.length <= 10 ? '•'.repeat(k.length) : `${k.slice(0, 4)}…${k.slice(-4)}`
}

// Google matches the redirect URI character for character against what the
// OAuth client lists, so the path has to be whatever was registered there.
// /auth/callback is the tidy one; OAUTH_REDIRECT_PATH covers a client that
// lists something else without needing a code change.
const DEFAULT_REDIRECT_PATH = '/auth/callback'
const CALLBACK_PATHS = ['/auth/callback', '/callback']

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

// Each of these must be a plain string. Pasting a whole JSON file into one of
// them leaves an object here, which is truthy — so checking only for presence
// would half-enable the gate on a value that cannot work.
const settingState = (value) => {
  if (value === undefined || value === null || value === '') return 'missing'
  if (typeof value !== 'string') return 'not a plain string — paste only the value, not a JSON file'
  if (!value.trim()) return 'blank'
  return 'ok'
}

const authConfig = (env) => {
  const checks = {
    GOOGLE_CLIENT_ID: settingState(env.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: settingState(env.GOOGLE_CLIENT_SECRET),
    SESSION_SECRET: settingState(env.SESSION_SECRET),
  }
  const path =
    typeof env.OAUTH_REDIRECT_PATH === 'string' && env.OAUTH_REDIRECT_PATH.trim()
      ? env.OAUTH_REDIRECT_PATH.trim()
      : DEFAULT_REDIRECT_PATH

  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    secret: env.SESSION_SECRET,
    domain: env.ALLOWED_DOMAIN || DEFAULT_DOMAIN,
    redirectPath: path.startsWith('/') ? path : `/${path}`,
    checks,
    ready: Object.values(checks).every((state) => state === 'ok'),
  }
}

// Sign-in is refused until it is configured, rather than quietly letting
// everyone in — a gate nobody set up must not look like a gate that passed.
// Says which setting is wrong and how, never what it holds.
const setupPage = (url, checks = {}, redirectPath = DEFAULT_REDIRECT_PATH) =>
  page(
    'Sign-in not configured',
    `<h1>Sign-in is not set up yet</h1>
     <p>This console stays closed until Google sign-in is configured. Add these
        in the Worker's settings as <strong>Secret</strong>, one value each:</p>
     <ol>
       ${['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET']
         .map((name) => {
           const state = checks[name] || 'missing'
           return `<li><code>${name}</code> — ${state === 'ok' ? 'set' : state}</li>`
         })
         .join('')}
     </ol>
     <p>Each is a single line of text. Pasting the whole downloaded JSON file into
        one of them will not work — take <code>client_id</code> and
        <code>client_secret</code> out of it.</p>
     <p>The OAuth client's authorised redirect URI must be exactly:<br>
        <code>${url.origin}${redirectPath}</code><br>
        If the client lists a different path, set <code>OAUTH_REDIRECT_PATH</code>
        to match it instead of editing the client.</p>`,
    503
  )

async function handleAuth(request, env, url, parts) {
  const config = authConfig(env)
  const redirectUri = `${url.origin}${config.redirectPath}`
  // The exchange must quote the same URI the sign-in was started with.
  const isCallback = CALLBACK_PATHS.includes(url.pathname)

  if (parts[1] === 'logout') {
    return new Response(null, {
      status: 302,
      headers: { location: '/', 'set-cookie': clearCookie(SESSION_COOKIE) },
    })
  }

  if (!config.ready) return setupPage(url, config.checks, config.redirectPath)

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

  if (isCallback) {
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
  if (!config.ready) return setupPage(url, config.checks, config.redirectPath)

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

// One store per signed-in person, so a key belongs to whoever saved it and
// cannot be read by anyone else. The key itself never leaves the Worker: the
// browser asks for a token and gets a token.
export class KeyStore {
  constructor(ctx) {
    this.ctx = ctx
    this.sql = ctx.storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS key_slots (
      slot TEXT PRIMARY KEY,
      api TEXT NOT NULL,
      environment TEXT NOT NULL,
      api_key TEXT NOT NULL,
      saved_ms INTEGER NOT NULL
    )`)

    // Keys saved before v1 existed were stored by environment alone; they were
    // all legacy keys, so that is where they belong.
    try {
      const old = this.sql.exec('SELECT environment, api_key, saved_ms FROM keys').toArray()
      for (const row of old) {
        this.sql.exec(
          `INSERT INTO key_slots (slot, api, environment, api_key, saved_ms) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(slot) DO NOTHING`,
          slotOf('legacy', row.environment),
          'legacy',
          row.environment,
          row.api_key,
          row.saved_ms
        )
      }
      if (old.length) this.sql.exec('DROP TABLE keys')
    } catch {
      // No old table: nothing to carry over.
    }
  }

  list() {
    const rows = this.sql.exec('SELECT * FROM key_slots').toArray()
    const out = {}
    for (const api of APIS) {
      out[api] = {}
      for (const environment of ENVIRONMENTS) out[api][environment] = { set: false }
    }
    for (const row of rows) {
      if (!out[row.api]) continue
      out[row.api][row.environment] = {
        set: true,
        hint: hintOf(row.api_key),
        savedAt: new Date(row.saved_ms).toISOString(),
      }
    }
    return out
  }

  keyFor(api, environment) {
    const row = this.sql
      .exec('SELECT api_key FROM key_slots WHERE slot = ?', slotOf(api, environment))
      .toArray()[0]
    return row ? row.api_key : null
  }

  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === 'GET') return json({ keys: this.list() })

    if (request.method === 'PUT') {
      const body = await request.json().catch(() => null)
      const api = (body && body.api) || 'legacy'
      const environment = body && body.environment
      const apiKey = body && typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
      if (!baseFor(api, environment)) return json({ error: 'Unknown api or environment' }, 400)
      if (!apiKey) return json({ error: 'No key given' }, 400)
      this.sql.exec(
        `INSERT INTO key_slots (slot, api, environment, api_key, saved_ms) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(slot) DO UPDATE SET api_key = excluded.api_key, saved_ms = excluded.saved_ms`,
        slotOf(api, environment),
        api,
        environment,
        apiKey,
        Date.now()
      )
      return json({ keys: this.list() })
    }

    if (request.method === 'DELETE') {
      const api = url.searchParams.get('api') || 'legacy'
      const environment = url.searchParams.get('environment')
      if (environment) this.sql.exec('DELETE FROM key_slots WHERE slot = ?', slotOf(api, environment))
      else this.sql.exec('DELETE FROM key_slots')
      return json({ keys: this.list() })
    }

    // Mint a legacy token from the stored key. The key stays here.
    if (request.method === 'POST' && url.pathname === '/token') {
      const body = await request.json().catch(() => null)
      const environment = (body && body.environment) || 'staging'
      const base = baseFor('legacy', environment)
      if (!base) return json({ error: 'Unknown environment' }, 400)

      const apiKey = this.keyFor('legacy', environment)
      if (!apiKey) return json({ error: 'no_key', environment }, 404)

      const res = await fetch(`${base}/api-auth/authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      }).catch(() => null)

      if (!res) return json({ error: 'The API could not be reached' }, 502)
      const answer = await res.json().catch(() => null)
      if (!res.ok || !answer || !answer.accessToken) {
        return json({ error: 'rejected', status: res.status }, res.status === 401 ? 401 : 502)
      }
      return json({ accessToken: answer.accessToken, environment })
    }

    // Hand the key to the Worker, which makes the call itself. Proxying from
    // in here made this one object the bottleneck for every v1 request:
    // a dozen at once queued behind each other instead of running side by
    // side. Workers scale out; a Durable Object does not.
    if (request.method === 'POST' && url.pathname === '/key') {
      const payload = await request.json().catch(() => null)
      const api = (payload && payload.api) || 'v1'
      const environment = (payload && payload.environment) || 'staging'
      if (!baseFor(api, environment)) return json({ error: 'Unknown api or environment' }, 400)

      const apiKey = this.keyFor(api, environment)
      if (!apiKey) return json({ error: 'no_key', api, environment }, 404)
      return json({ apiKey })
    }

    return json({ error: 'Not found' }, 404)
  }
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env)
    } catch (err) {
      // Without this the platform answers with its own "Worker threw
      // exception" page, which is HTML, carries no CORS headers and names
      // nothing — the tool then shows an empty panel and no reason for it.
      return json(
        {
          error: 'The console hit an internal error.',
          detail: String((err && err.message) || err),
          where: new URL(request.url).pathname,
        },
        500
      )
    }
  },
}

async function handle(request, env) {
  {
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
    if (request.method === 'POST' && !['auth', 'links', 'keys'].includes(parts[0])) {
      return store(DEFAULT_HOOK)
    }

    // --- public: signing in. The callback may also arrive at a bare /callback,
    // because that is what some OAuth clients were registered with.
    if (parts[0] === 'auth' || CALLBACK_PATHS.includes(url.pathname)) {
      return handleAuth(request, env, url, parts)
    }

    // --- everything past here needs a session
    const refused = await gate(request, env, url)
    if (refused) return refused

    // The v1 proxy lives here rather than in the key store, so concurrent
    // calls fan out across Worker instances instead of queueing behind one
    // Durable Object. The key is fetched from the store and used here; it
    // still never reaches the browser.
    if (parts[0] === 'keys' && parts[1] === 'proxy' && request.method === 'POST') {
      const session = await verifySession(
        parseCookies(request.headers.get('cookie'))[SESSION_COOKIE],
        authConfig(env).secret
      )
      const payload = await request.json().catch(() => null)
      const environment = (payload && payload.environment) || 'staging'
      const target = payload && payload.path
      const base = baseFor('v1', environment)
      if (!base || typeof target !== 'string' || !target.startsWith('/')) {
        return json({ error: 'Unknown environment or path' }, 400)
      }

      const found = await apiKeyFor(env, session.email, 'v1', environment)
      if (!found.apiKey) {
        return json({ error: found.error || 'no_key', api: 'v1', environment }, found.status || 500)
      }
      const keyBody = { apiKey: found.apiKey }

      const method = (payload.method || 'POST').toUpperCase()
      const started = Date.now()
      const res = await fetch(base + target, {
        method,
        headers: {
          'X-API-Key': keyBody.apiKey,
          ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
        },
        body: method === 'GET' ? undefined : JSON.stringify(payload.body ?? {}),
      }).catch(() => null)

      if (!res) return json({ error: 'unreachable' }, 502)

      const text = await res.text()
      return json({
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries(res.headers),
        raw: text,
        elapsedMs: Date.now() - started,
      })
    }

    if (parts[0] === 'keys' && (!parts[1] || parts[1] === 'token')) {
      const session = await verifySession(
        parseCookies(request.headers.get('cookie'))[SESSION_COOKIE],
        authConfig(env).secret
      )
      // The gate above already refused anyone without a session.
      // A save or a removal must not leave a stale key in the cache.
      if (request.method === 'PUT' || request.method === 'DELETE') {
        forgetCachedKeys(session.email)
      }
      const stub = env.KEYS.get(env.KEYS.idFromName(session.email))
      const inner = parts[1] ? `https://do/${parts[1]}` : `https://do/${url.search}`
      const method = parts[1] ? 'POST' : request.method
      return stub.fetch(
        new Request(inner, {
          method,
          headers: request.headers,
          body: method === 'GET' || method === 'DELETE' ? undefined : request.body,
        })
      )
    }

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
  }
}
