# Up2Data API Tester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An internal browser tool that exercises every Up2Data API endpoint, shows every optional parameter behind a checkbox, and receives webhook callbacks in-page.

**Architecture:** One Cloudflare Worker serves a static UI and owns `/hook/:id` (webhook sink, Workers KV, 24h TTL) plus `/hook/:id/events` (same-origin read). API calls go straight from the browser to `api.uptodata.io`; credentials never touch the Worker.

**Tech Stack:** Cloudflare Workers (`wrangler` 4.x), Workers KV, vanilla ES modules, `vitest` + `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-09-17-up2data-tester-design.md`

## Global Constraints

- API base URL: `https://api.uptodata.io/api`
- `Authorization` header carries the raw JWT with **no** `Bearer` prefix.
- Unchecked optional field = key absent from the body. Never `null`, never `false`.
- `webhookTags: []` is meaningful (suppresses callbacks) and must survive as an empty array.
- `/open-refresh/list` requires `queueId`, `page` (0-indexed) and `limit` (1–25) on every call.
- Worker answers `/hook/:id` with 200 in under 3 seconds, always — a non-2xx triggers the API's retry schedule.
- Callback bodies are third-party input: render with `textContent`, never `innerHTML`.
- No bundler. `npm` is for `wrangler` and tests only.

## File Structure

| File | Responsibility |
|---|---|
| `wrangler.toml` | Worker name, KV binding, assets/entry config |
| `package.json` | devDeps + scripts (`dev`, `deploy`, `test`) |
| `src/worker.js` | Routing: `/`, `/hook/:id`, `/hook/:id/events`, static files |
| `src/endpoints.js` | Declarative registry of all 16 endpoints (fields + credit formulas) |
| `src/request.js` | `buildBody`, `buildQuery`, `toCurl` — pure, no DOM |
| `src/credits.js` | `estimateCredits` — pure |
| `src/api.js` | `callApi` — fetch wrapper returning `{status, headers, body, raw, elapsedMs}` |
| `src/ui/form.js` | Renders a form from a registry entry; reads form state back |
| `src/ui/queues.js` | Queue list, status polling, `/list` paging |
| `src/ui/webhooks.js` | Hook id, callback polling, rendering |
| `src/app.js` | Wires the panels together; `localStorage` for token/queues/hook id |
| `src/index.html` | Layout shell |
| `src/app.css` | Styling |
| `test/*.test.js` | Unit tests (request, credits) and Worker route tests |

---

### Task 1: Scaffold + Worker hook routes

**Files:**
- Create: `package.json`, `wrangler.toml`, `vitest.config.js`, `src/worker.js`
- Test: `test/worker.test.js`

**Interfaces:**
- Produces: Worker `fetch(request, env)` handler; KV binding named `HOOKS`; routes `POST /hook/:id`, `GET /hook/:id/events`, `DELETE /hook/:id`.
- Event record shape: `{ id, receivedAt, headers: {..}, body: <parsed JSON|null>, raw: <string> }`.

- [ ] **Step 1: Write the failing tests**

```js
// test/worker.test.js
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import worker from '../src/worker.js'

async function call(method, path, body) {
  const req = new Request(`https://x${path}`, {
    method,
    body: body === undefined ? undefined : body,
    headers: { 'content-type': 'application/json', 'x-webhook-secret': 's3cret' },
  })
  const ctx = createExecutionContext()
  const res = await worker.fetch(req, env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

describe('hook sink', () => {
  it('accepts a JSON callback and answers 200', async () => {
    const res = await call('POST', '/hook/abc', JSON.stringify([{ type: 'Profile' }]))
    expect(res.status).toBe(200)
  })

  it('answers 200 for a body that is not JSON', async () => {
    const res = await call('POST', '/hook/abc', 'not json at all')
    expect(res.status).toBe(200)
  })

  it('returns stored callbacks newest first', async () => {
    await call('POST', '/hook/feed', JSON.stringify({ n: 1 }))
    await call('POST', '/hook/feed', JSON.stringify({ n: 2 }))
    const res = await call('GET', '/hook/feed/events')
    const { events } = await res.json()
    expect(events.length).toBe(2)
    expect(events[0].body.n).toBe(2)
    expect(events[0].headers['x-webhook-secret']).toBe('s3cret')
  })

  it('keeps the raw text when the body is not JSON', async () => {
    await call('POST', '/hook/raw', 'plain text')
    const { events } = await (await call('GET', '/hook/raw/events')).json()
    expect(events[0].body).toBe(null)
    expect(events[0].raw).toBe('plain text')
  })

  it('clears a hook on DELETE', async () => {
    await call('POST', '/hook/gone', JSON.stringify({ n: 1 }))
    await call('DELETE', '/hook/gone')
    const { events } = await (await call('GET', '/hook/gone/events')).json()
    expect(events).toEqual([])
  })

  it('does not leak callbacks across hook ids', async () => {
    await call('POST', '/hook/one', JSON.stringify({ n: 1 }))
    const { events } = await (await call('GET', '/hook/two/events')).json()
    expect(events).toEqual([])
  })

  it('404s an unknown path', async () => {
    expect((await call('GET', '/nope')).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/worker.js` does not exist.

- [ ] **Step 3: Write config and the Worker**

```toml
# wrangler.toml
name = "up2data-tester"
main = "src/worker.js"
compatibility_date = "2025-09-01"

[[kv_namespaces]]
binding = "HOOKS"
id = "PLACEHOLDER_REPLACED_BY_WRANGLER"
preview_id = "PLACEHOLDER_REPLACED_BY_WRANGLER"

[assets]
directory = "src"
binding = "ASSETS"
```

```js
// src/worker.js
const TTL_SECONDS = 24 * 60 * 60

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

async function storeCallback(env, id, request) {
  const raw = await request.text()
  let body = null
  try { body = JSON.parse(raw) } catch { body = null }

  const receivedAt = new Date().toISOString()
  const key = `hook:${id}:${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const record = {
    id: key,
    receivedAt,
    headers: Object.fromEntries(request.headers),
    body,
    raw,
  }
  await env.HOOKS.put(key, JSON.stringify(record), { expirationTtl: TTL_SECONDS })
}

async function listCallbacks(env, id) {
  const { keys } = await env.HOOKS.list({ prefix: `hook:${id}:` })
  const events = await Promise.all(
    keys.map(async (k) => {
      const value = await env.HOOKS.get(k.name)
      return value ? JSON.parse(value) : null
    })
  )
  return events.filter(Boolean).sort((a, b) => (a.id < b.id ? 1 : -1))
}

async function clearCallbacks(env, id) {
  const { keys } = await env.HOOKS.list({ prefix: `hook:${id}:` })
  await Promise.all(keys.map((k) => env.HOOKS.delete(k.name)))
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts[0] === 'hook' && parts[1]) {
      const id = parts[1]

      if (parts[2] === 'events' && request.method === 'GET') {
        return json({ events: await listCallbacks(env, id) })
      }
      if (!parts[2] && request.method === 'POST') {
        // Always 200, even on a storage failure: a non-2xx starts the
        // API's retry schedule (10min, 1h, 8h, 24h).
        try { await storeCallback(env, id, request) } catch (err) {
          console.error('store failed', err)
        }
        return json({ received: true })
      }
      if (!parts[2] && request.method === 'DELETE') {
        await clearCallbacks(env, id)
        return json({ cleared: true })
      }
      return json({ error: 'Not found' }, 404)
    }

    if (env.ASSETS) return env.ASSETS.fetch(request)
    return json({ error: 'Not found' }, 404)
  },
}
```

```json
// package.json
{
  "name": "up2data-tester",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "vitest": "~3.0.0",
    "wrangler": "^4.0.0"
  }
}
```

```js
// vitest.config.js
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: { wrangler: { configPath: './wrangler.toml' } },
    },
  },
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm install && npm test`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add package.json wrangler.toml vitest.config.js src/worker.js test/worker.test.js
git commit -m "feat: worker webhook sink with KV storage"
```

---

### Task 2: Request builder

**Files:**
- Create: `src/request.js`
- Test: `test/request.test.js`

**Interfaces:**
- Produces:
  - `buildBody(fields, state) -> object` — `fields` is the registry's field array, `state` is `{ [name]: { enabled: boolean, value: any } }`. Required fields are always included; optional fields only when `enabled`.
  - `buildQuery(fields, state) -> string` — same rules, returns a query string without the leading `?`.
  - `toCurl({ method, url, token, body }) -> string`
  - `parseLines(text) -> string[]` — splits on newlines, trims, drops empties.

- [ ] **Step 1: Write the failing tests**

```js
// test/request.test.js
import { describe, it, expect } from 'vitest'
import { buildBody, buildQuery, parseLines, toCurl } from '../src/request.js'

const fields = [
  { name: 'name', type: 'text', required: true },
  { name: 'profiles', type: 'lines', required: true },
  { name: 'priority', type: 'number', required: true },
  { name: 'withFollowersAndConnections', type: 'boolean', required: false },
  { name: 'webhookTags', type: 'tags', required: false },
]

describe('buildBody', () => {
  it('includes required fields', () => {
    const body = buildBody(fields, {
      name: { value: 'Job' },
      profiles: { value: 'a\nb' },
      priority: { value: 2 },
    })
    expect(body).toEqual({ name: 'Job', profiles: ['a', 'b'], priority: 2 })
  })

  it('omits an unchecked optional boolean entirely', () => {
    const body = buildBody(fields, {
      name: { value: 'Job' }, profiles: { value: 'a' }, priority: { value: 2 },
      withFollowersAndConnections: { enabled: false, value: true },
    })
    expect('withFollowersAndConnections' in body).toBe(false)
  })

  it('sends false when the optional boolean is checked and set to false', () => {
    const body = buildBody(fields, {
      name: { value: 'J' }, profiles: { value: 'a' }, priority: { value: 2 },
      withFollowersAndConnections: { enabled: true, value: false },
    })
    expect(body.withFollowersAndConnections).toBe(false)
  })

  it('keeps webhookTags as an empty array when checked and empty', () => {
    const body = buildBody(fields, {
      name: { value: 'J' }, profiles: { value: 'a' }, priority: { value: 2 },
      webhookTags: { enabled: true, value: [] },
    })
    expect(body.webhookTags).toEqual([])
  })

  it('coerces number fields out of string inputs', () => {
    const body = buildBody(fields, {
      name: { value: 'J' }, profiles: { value: 'a' }, priority: { value: '1' },
    })
    expect(body.priority).toBe(1)
  })
})

describe('buildQuery', () => {
  const qFields = [
    { name: 'queueId', type: 'text', required: true },
    { name: 'page', type: 'number', required: true },
    { name: 'limit', type: 'number', required: true },
    { name: 'failed', type: 'boolean', required: false },
  ]

  it('builds required params', () => {
    const q = buildQuery(qFields, {
      queueId: { value: 'q1' }, page: { value: 0 }, limit: { value: 10 },
    })
    expect(q).toBe('queueId=q1&page=0&limit=10')
  })

  it('omits an unchecked optional param', () => {
    const q = buildQuery(qFields, {
      queueId: { value: 'q1' }, page: { value: 0 }, limit: { value: 10 },
      failed: { enabled: false, value: true },
    })
    expect(q).not.toContain('failed')
  })
})

describe('parseLines', () => {
  it('trims and drops blank lines', () => {
    expect(parseLines(' a \n\n b \n')).toEqual(['a', 'b'])
  })
})

describe('toCurl', () => {
  it('emits the raw token with no Bearer prefix', () => {
    const cmd = toCurl({ method: 'POST', url: 'https://x/y', token: 'TK', body: { a: 1 } })
    expect(cmd).toContain("-H 'Authorization: TK'")
    expect(cmd).not.toContain('Bearer')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/request.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// src/request.js
export const parseLines = (text) =>
  String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean)

function coerce(field, raw) {
  switch (field.type) {
    case 'lines': return Array.isArray(raw) ? raw : parseLines(raw)
    case 'number': return raw === '' || raw === null || raw === undefined ? undefined : Number(raw)
    case 'boolean': return Boolean(raw)
    case 'tags': return Array.isArray(raw) ? raw : parseLines(raw)
    case 'links': return (raw || []).map((row) => {
      const link = { url: row.url }
      if (row.limitEnabled && row.limit !== '' && row.limit !== undefined) {
        link.limit = Number(row.limit)
      }
      return link
    })
    default: return raw
  }
}

// An optional field is included only when its checkbox is on. This is the
// whole point of the tool: omitted and `false` are different requests.
const included = (field, entry) => field.required || (entry && entry.enabled)

export function buildBody(fields, state) {
  const body = {}
  for (const field of fields) {
    const entry = state[field.name]
    if (!included(field, entry)) continue
    const value = coerce(field, entry ? entry.value : undefined)
    if (value === undefined) continue
    body[field.name] = value
  }
  return body
}

export function buildQuery(fields, state) {
  const params = []
  for (const field of fields) {
    const entry = state[field.name]
    if (!included(field, entry)) continue
    const value = coerce(field, entry ? entry.value : undefined)
    if (value === undefined) continue
    params.push(`${encodeURIComponent(field.name)}=${encodeURIComponent(value)}`)
  }
  return params.join('&')
}

export function toCurl({ method, url, token, body }) {
  const lines = [`curl -X ${method} '${url}'`]
  if (body) lines.push(`  -H 'Content-Type: application/json'`)
  if (token) lines.push(`  -H 'Authorization: ${token}'`)
  if (body) lines.push(`  -d '${JSON.stringify(body, null, 2)}'`)
  return lines.join(' \\\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/request.test.js`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add src/request.js test/request.test.js
git commit -m "feat: request builder honouring optional-field checkboxes"
```

---

### Task 3: Endpoint registry + credit estimator

**Files:**
- Create: `src/endpoints.js`, `src/credits.js`
- Test: `test/credits.test.js`

**Interfaces:**
- Consumes: field `type` values from Task 2 (`text`, `lines`, `number`, `boolean`, `tags`, `links`).
- Produces:
  - `ENDPOINTS` — array of `{ id, group, label, method, path, auth, fields, credits, docs }`.
  - `credits` on each entry is `(state) => { amount, reserved, note }` or `null` for free endpoints. `reserved: true` means credits are held against a limit and refunded later — those require the confirm dialog.
  - `estimateCredits(endpoint, state) -> { amount, reserved, note } | null`.

- [ ] **Step 1: Write the failing tests**

```js
// test/credits.test.js
import { describe, it, expect } from 'vitest'
import { ENDPOINTS, byId } from '../src/endpoints.js'
import { estimateCredits } from '../src/credits.js'

const est = (id, state) => estimateCredits(byId(id), state)

describe('registry', () => {
  it('covers all sixteen endpoints', () => {
    expect(ENDPOINTS.length).toBe(16)
  })
  it('marks every endpoint except authenticate as auth-required', () => {
    expect(byId('authenticate').auth).toBe(false)
    expect(byId('profiles-bulk').auth).toBe(true)
  })
})

describe('estimateCredits', () => {
  it('charges 1 per profile without the followers flag', () => {
    expect(est('profiles-bulk', { profiles: { value: 'a\nb\nc' } }).amount).toBe(3)
  })

  it('charges 2 per profile when the followers flag is checked and true', () => {
    expect(est('profiles-bulk', {
      profiles: { value: 'a\nb\nc' },
      withFollowersAndConnections: { enabled: true, value: true },
    }).amount).toBe(6)
  })

  it('ignores the followers flag when it is unchecked', () => {
    expect(est('profiles-bulk', {
      profiles: { value: 'a\nb' },
      withFollowersAndConnections: { enabled: false, value: true },
    }).amount).toBe(2)
  })

  it('charges 4 per profile for activity', () => {
    expect(est('activity', { profiles: { value: 'a\nb' } }).amount).toBe(8)
  })

  it('charges 2 per profile for posts, comments and reactions', () => {
    for (const id of ['posts', 'comments', 'reactions']) {
      expect(est(id, { profiles: { value: 'a\nb' } }).amount).toBe(4)
    }
  })

  it('charges 5 per profile for latest-post', () => {
    expect(est('latest-post', { profiles: { value: 'a\nb' } }).amount).toBe(10)
  })

  it('charges 2 for a live profile and 4 with the flag', () => {
    expect(est('profile', { profile: { value: 'x' } }).amount).toBe(2)
    expect(est('profile', {
      profile: { value: 'x' },
      withFollowersAndConnections: { enabled: true, value: true },
    }).amount).toBe(4)
  })

  it('reserves limit x 3 per search link', () => {
    const r = est('search', {
      salesNavigatorLinks: { value: [
        { url: 'https://www.linkedin.com/sales/search/people?query=a', limitEnabled: true, limit: 500 },
      ] },
    })
    expect(r.amount).toBe(1500)
    expect(r.reserved).toBe(true)
  })

  it('reserves limit x 4 for a people link with the followers flag', () => {
    const r = est('search', {
      salesNavigatorLinks: { value: [
        { url: 'https://www.linkedin.com/sales/search/people?query=a', limitEnabled: true, limit: 500 },
      ] },
      withFollowersAndConnections: { enabled: true, value: true },
    })
    expect(r.amount).toBe(2000)
  })

  it('keeps company links at x3 even with the followers flag', () => {
    const r = est('search', {
      salesNavigatorLinks: { value: [
        { url: 'https://www.linkedin.com/sales/search/company?query=a', limitEnabled: true, limit: 100 },
      ] },
      withFollowersAndConnections: { enabled: true, value: true },
    })
    expect(r.amount).toBe(300)
  })

  it('assumes the 2500 maximum when a people search limit is unchecked', () => {
    const r = est('search', {
      salesNavigatorLinks: { value: [
        { url: 'https://www.linkedin.com/sales/search/people?query=a', limitEnabled: false },
      ] },
    })
    expect(r.amount).toBe(7500)
  })

  it('assumes the 1000 maximum when a company search limit is unchecked', () => {
    const r = est('search', {
      salesNavigatorLinks: { value: [
        { url: 'https://www.linkedin.com/sales/search/company?query=a', limitEnabled: false },
      ] },
    })
    expect(r.amount).toBe(3000)
  })

  it('charges limit x 1 for partial searches', () => {
    expect(est('partial-sales-profiles', {
      salesNavigatorLinks: { value: [{ url: 'u', limitEnabled: true, limit: 250 }] },
    }).amount).toBe(250)
    expect(est('partial-sales-companies', {
      salesNavigatorLinks: { value: [{ url: 'u', limitEnabled: false }] },
    }).amount).toBe(1000)
  })

  it('returns null for free endpoints', () => {
    expect(est('status', {})).toBe(null)
    expect(est('list', {})).toBe(null)
    expect(est('authenticate', {})).toBe(null)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/credits.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the registry and estimator**

Write `src/endpoints.js` exporting `ENDPOINTS` and `byId(id)`. Each entry
carries `fields` using the Task 2 types and a `credits(state)` function.
Field lists come verbatim from the spec's endpoint tables. Free endpoints
set `credits: null`.

Shared helpers inside `src/endpoints.js`:

```js
import { parseLines } from './request.js'

const count = (state, field) => parseLines(state[field]?.value).length
const flagOn = (state) => {
  const e = state.withFollowersAndConnections
  return Boolean(e && e.enabled && e.value)
}
const perProfile = (rate, withFlagRate = null) => (state) => {
  const n = count(state, 'profiles')
  const each = withFlagRate && flagOn(state) ? withFlagRate : rate
  return { amount: n * each, reserved: false, note: `${n} x ${each}` }
}
const PEOPLE_MAX = 2500
const COMPANY_MAX = 1000
const isPeople = (url) => String(url).includes('/sales/search/people')
const linkLimit = (row) =>
  row.limitEnabled && row.limit !== '' && row.limit !== undefined
    ? Number(row.limit)
    : (isPeople(row.url) ? PEOPLE_MAX : COMPANY_MAX)
```

`search` credits:

```js
credits: (state) => {
  const rows = state.salesNavigatorLinks?.value || []
  const flag = flagOn(state)
  const amount = rows.reduce((sum, row) => {
    const rate = flag && isPeople(row.url) ? 4 : 3
    return sum + linkLimit(row) * rate
  }, 0)
  return { amount, reserved: true, note: 'reserved against each link limit; unused credits are refunded' }
}
```

`partial-sales-profiles` / `partial-sales-companies` credits: the same
reduce at rate `1`, with `reserved: true`.

```js
// src/credits.js
export function estimateCredits(endpoint, state) {
  if (!endpoint || !endpoint.credits) return null
  return endpoint.credits(state)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/credits.test.js`
Expected: 15 passing.

- [ ] **Step 5: Commit**

```bash
git add src/endpoints.js src/credits.js test/credits.test.js
git commit -m "feat: endpoint registry and credit estimator"
```

---

### Task 4: API client + auth panel + form rendering

**Files:**
- Create: `src/api.js`, `src/ui/form.js`, `src/index.html`, `src/app.css`, `src/app.js`

**Interfaces:**
- Consumes: `ENDPOINTS`, `byId` (Task 3); `buildBody`, `buildQuery`, `toCurl` (Task 2).
- Produces:
  - `callApi({ endpoint, state, token }) -> { ok, status, statusText, headers, body, raw, elapsedMs, transportError }`
  - `renderForm(container, endpoint, state, onChange)` — draws required fields plus a checkbox per optional field.
  - `readState(container, endpoint) -> state` — the `{name: {enabled, value}}` shape Task 2 consumes.

- [ ] **Step 1: Write `src/api.js`**

```js
import { buildBody, buildQuery } from './request.js'

export const BASE = 'https://api.uptodata.io/api'

export async function callApi({ endpoint, state, token }) {
  const started = performance.now()
  let url = BASE + endpoint.path
  const init = { method: endpoint.method, headers: {} }

  if (endpoint.method === 'GET') {
    const q = buildQuery(endpoint.fields, state)
    if (q) url += `?${q}`
  } else {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(buildBody(endpoint.fields, state))
  }
  if (endpoint.auth && token) init.headers['Authorization'] = token

  try {
    const res = await fetch(url, init)
    const raw = await res.text()
    let body = null
    try { body = JSON.parse(raw) } catch { body = null }
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers),
      body, raw,
      elapsedMs: Math.round(performance.now() - started),
    }
  } catch (err) {
    // A rejected fetch is a transport or CORS failure, not an HTTP status.
    return { transportError: String(err), elapsedMs: Math.round(performance.now() - started) }
  }
}
```

- [ ] **Step 2: Write `src/ui/form.js`**

Renders one row per field. Required rows show a "required" badge; optional
rows lead with a checkbox that enables the input. The `links` type renders
repeating rows with an "Add link" button, each row holding a URL input and
its own optional `limit` checkbox + number input.

- [ ] **Step 3: Write `src/index.html` and `src/app.css`**

Three-column shell: endpoint list, form + request preview, response +
queues + webhooks.

- [ ] **Step 4: Wire `src/app.js`**

Auth panel (API key → `authenticate` → token in `localStorage` with an
`issuedAt` and a 24h countdown), endpoint selection, live request preview,
credit line, and the send button. When `estimateCredits` returns
`reserved: true`, `confirm()` the amount before sending.

- [ ] **Step 5: Verify by hand**

Run: `npx wrangler dev`
Open the printed URL; confirm the request preview gains and loses
`withFollowersAndConnections` as the checkbox toggles, and that the credit
line matches.

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "feat: api client, auth panel and generated forms"
```

---

### Task 5: Response viewer, queue tracker, webhook panel

**Files:**
- Create: `src/ui/queues.js`, `src/ui/webhooks.js`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `callApi` (Task 4), `byId` (Task 3).
- Produces:
  - `captureQueues(response) -> string[]` — pulls `queueId` and `queueIds` out of a response body.
  - `renderResponse(container, result)` — status, elapsed, `RateLimit-*`, pretty body, both error shapes (`message` string and `errors` array).
  - `startPolling(queueId, token, onTick)` / `stopPolling(queueId)`.
  - `hookId()` — reads or creates the `localStorage` hook id.
  - `pollCallbacks(hookId, onEvents)` — polls `/hook/:id/events`.

- [ ] **Step 1: Write `src/ui/queues.js`**

Queue list in `localStorage` keyed by id, each `{ id, endpointId, name, createdAt }`.
Polling auto-starts for a queue the tool just created and stops at
`status === 'completed'`; queues restored on page load show "Resume polling"
instead. `/list` paging clamps `limit` to 1–25 and `page` to >= 0, and shows
`totalResults` when present.

- [ ] **Step 2: Write `src/ui/webhooks.js`**

Shows the full callback URL for the current hook id, a copy button, the
three setup steps, a live list of arriving callbacks (`type`, `queueId`,
`name`, `url`, expandable `result`), a counter and a clear button. Every
value goes in via `textContent`.

- [ ] **Step 3: Verify by hand**

Run: `npx wrangler dev`, then from a second terminal:

```bash
curl -X POST http://localhost:8787/hook/<id-from-ui> \
  -H 'Content-Type: application/json' \
  -d '[{"type":"Profile","queueId":"q1","result":{"firstName":"Test"}}]'
```

Expected: the callback appears in the webhook panel within a few seconds.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: response viewer, queue tracker and webhook panel"
```

---

### Task 6: Deploy

**Files:**
- Modify: `wrangler.toml`, `README.md`

- [ ] **Step 1: Create the KV namespace**

```bash
npx wrangler kv namespace create HOOKS
npx wrangler kv namespace create HOOKS --preview
```

Paste the returned ids into `wrangler.toml`.

- [ ] **Step 2: Deploy**

```bash
npx wrangler deploy
```

- [ ] **Step 3: Verify against the live API**

Authenticate with a real API key, then send one `POST /open-refresh/company`
(2 credits) and confirm the response viewer shows the Company document and
the `RateLimit-*` headers.

Also confirm the documented transposition: send `POST /open-refresh/posts`
and `POST /open-refresh/latest-post` and check each returns its own shape.

- [ ] **Step 4: Write `README.md`**

Deployed URL, how to get an API key, how to register the webhook URL with a
tag, and the credit table.

- [ ] **Step 5: Commit**

```bash
git add wrangler.toml README.md
git commit -m "chore: deploy config and README"
```
