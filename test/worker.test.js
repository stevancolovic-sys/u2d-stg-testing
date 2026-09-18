import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import worker from '../src/worker.js'
import { signSession, SESSION_COOKIE } from '../src/auth.js'

const SECRET = 'test-session-secret-long-enough'

// Sign-in is configured for these tests; a few cases override it.
const configured = {
  ...env,
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  SESSION_SECRET: SECRET,
  ALLOWED_DOMAIN: 'totema.co',
}

let signedIn = ''
beforeAll(async () => {
  const token = await signSession(
    { email: 'stevan@totema.co', exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET
  )
  signedIn = `${SESSION_COOKIE}=${token}`
})

async function send(method, path, body, { cookie, environment } = {}) {
  const headers = { 'content-type': 'application/json', 'x-webhook-secret': 's3cret' }
  if (cookie) headers.cookie = cookie
  const req = new Request(`https://x${path}`, { method, body, headers })
  const ctx = createExecutionContext()
  const res = await worker.fetch(req, environment || configured, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

// Everything the existing suites do is done as a signed-in person.
const call = (method, path, body) => send(method, path, body, { cookie: signedIn })
const anon = (method, path, body) => send(method, path, body)

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
    await new Promise((r) => setTimeout(r, 2))
    await call('POST', '/hook/feed', JSON.stringify({ n: 2 }))
    const { events } = await (await call('GET', '/hook/feed/events')).json()
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

  it('404s an unknown hook path', async () => {
    expect((await call('PUT', '/hook/abc')).status).toBe(404)
  })
})

describe('saved links', () => {
  const save = (links) => call('POST', '/links', JSON.stringify(links))

  it('starts empty and stores what it is given', async () => {
    const res = await save([
      { key: 'linkedin.com/in/johndoe', id: 'l1', url: 'https://www.linkedin.com/in/johndoe', type: 'profile', label: 'John', tags: ['q1'] },
    ])
    const { saved, links } = await res.json()
    expect(saved).toBe(1)
    expect(links.find((l) => l.id === 'l1').label).toBe('John')
    expect(links.find((l) => l.id === 'l1').tags).toEqual(['q1'])
  })

  it('reads them back on a GET', async () => {
    const { links } = await (await call('GET', '/links')).json()
    expect(links.some((l) => l.url.includes('johndoe'))).toBe(true)
  })

  it('updates rather than duplicating when the same key comes back', async () => {
    await save([{ key: 'linkedin.com/in/johndoe', id: 'l1', url: 'https://www.linkedin.com/in/johndoe', type: 'profile', label: 'Renamed', tags: [] }])
    const { links } = await (await call('GET', '/links')).json()
    const matching = links.filter((l) => l.url.includes('johndoe'))
    expect(matching.length).toBe(1)
    expect(matching[0].label).toBe('Renamed')
  })

  it('saves several at once', async () => {
    const { saved } = await (await save([
      { key: 'k-a', id: 'a', url: 'https://www.linkedin.com/company/acme', type: 'company', label: 'Acme', tags: [] },
      { key: 'k-b', id: 'b', url: 'https://www.linkedin.com/sales/search/people?query=x', type: 'leadSearch', label: 'Leads', tags: [] },
    ])).json()
    expect(saved).toBe(2)
  })

  it('skips an entry with no url or key instead of storing rubbish', async () => {
    await save([{ key: '', url: '' }, null])
    const { links } = await (await call('GET', '/links')).json()
    expect(links.every((l) => l.url)).toBe(true)
  })

  it('deletes one by id', async () => {
    await call('DELETE', '/links?id=a')
    const { links } = await (await call('GET', '/links')).json()
    expect(links.some((l) => l.id === 'a')).toBe(false)
    expect(links.some((l) => l.id === 'b')).toBe(true)
  })

  it('does not swallow a callback posted to the root', async () => {
    const res = await anon('POST', '/', JSON.stringify([{ type: 'Profile' }]))
    expect(res.status).toBe(200)
    const { links } = await (await call('GET', '/links')).json()
    expect(links.some((l) => l.type === 'Profile')).toBe(false)
  })
})

describe('the gate', () => {
  it('lets a callback through without signing in — uptodata cannot', async () => {
    expect((await anon('POST', '/hook/public-check', JSON.stringify({ n: 1 }))).status).toBe(200)
    expect((await anon('POST', '/', JSON.stringify([{ type: 'Profile' }]))).status).toBe(200)
    expect((await anon('POST', '/anything-else', JSON.stringify({ n: 2 }))).status).toBe(200)
  })

  it('stops a browser at the door', async () => {
    const res = await anon('GET', '/')
    expect(res.status).toBe(401)
    expect(await res.text()).toContain('Sign in with Google')
  })

  it('keeps the data behind it too', async () => {
    expect((await anon('GET', '/links')).status).toBe(401)
    expect((await anon('GET', '/hook/abc/events')).status).toBe(401)
  })

  it('lets a valid session through', async () => {
    expect((await call('GET', '/links')).status).toBe(200)
  })

  it('refuses a session signed with another secret', async () => {
    const forged = await signSession(
      { email: 'intruder@evil.com', exp: Math.floor(Date.now() / 1000) + 3600 },
      'not-the-real-secret'
    )
    const res = await send('GET', '/links', undefined, { cookie: `${SESSION_COOKIE}=${forged}` })
    expect(res.status).toBe(401)
  })

  it('refuses an expired session', async () => {
    const stale = await signSession(
      { email: 'stevan@totema.co', exp: Math.floor(Date.now() / 1000) - 10 },
      SECRET
    )
    expect((await send('GET', '/links', undefined, { cookie: `${SESSION_COOKIE}=${stale}` })).status).toBe(401)
  })

  it('refuses a setting that holds a pasted JSON file rather than a value', async () => {
    const wrong = {
      ...configured,
      // What pasting the downloaded client_secret.json produces.
      GOOGLE_CLIENT_SECRET: { web: { client_id: 'x', client_secret: 'y' } },
    }
    const res = await send('GET', '/', undefined, { cookie: signedIn, environment: wrong })
    expect(res.status).toBe(503)
    const body = await res.text()
    expect(body).toContain('not a plain string')
    // It names the setting and its state, never the value.
    expect(body).not.toContain('client_secret": "y')
  })

  it('names which settings are missing without printing any of them', async () => {
    const partial = { ...configured, SESSION_SECRET: '' }
    const body = await (await send('GET', '/', undefined, { environment: partial })).text()
    expect(body).toContain('SESSION_SECRET')
    expect(body).toContain('missing')
    expect(body).not.toContain('test-client-secret')
  })

  it('stays shut when sign-in has not been configured, rather than open', async () => {
    const bare = { ...env, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', SESSION_SECRET: '' }
    const res = await send('GET', '/', undefined, { cookie: signedIn, environment: bare })
    expect(res.status).toBe(503)
    expect(await res.text()).toContain('not set up yet')
  })

  it('still takes callbacks while sign-in is unconfigured', async () => {
    const bare = { ...env, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', SESSION_SECRET: '' }
    expect((await send('POST', '/', JSON.stringify({ n: 1 }), { environment: bare })).status).toBe(200)
  })
})

describe('signing in', () => {
  it('sends you to Google, remembering the request it started', async () => {
    const res = await anon('GET', '/auth/login')
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location'))
    expect(location.host).toBe('accounts.google.com')
    expect(location.searchParams.get('hd')).toBe('totema.co')
    expect(location.searchParams.get('state')).toBeTruthy()
    expect(res.headers.get('set-cookie')).toContain('u2d_state=')
  })

  it('refuses a callback whose state does not match the one it issued', async () => {
    const res = await send('GET', '/auth/callback?code=abc&state=forged', undefined, {
      cookie: 'u2d_state=the-real-one',
    })
    expect(res.status).toBe(400)
  })

  it('refuses a callback with no state at all', async () => {
    expect((await anon('GET', '/auth/callback?code=abc')).status).toBe(400)
  })

  it('says who is signed in, and does not to a stranger', async () => {
    const mine = await (await call('GET', '/auth/me')).json()
    expect(mine.email).toBe('stevan@totema.co')
    expect((await anon('GET', '/auth/me')).status).toBe(401)
  })

  it('signs out by expiring the cookie', async () => {
    const res = await call('GET', '/auth/logout')
    expect(res.status).toBe(302)
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

describe('a webhook pointed at the origin', () => {
  it('accepts a POST to the root instead of answering 405', async () => {
    const res = await call('POST', '/', JSON.stringify([{ type: 'Profile', queueId: 'q1' }]))
    expect(res.status).toBe(200)
  })

  it('files it under the default bucket where the panel can read it', async () => {
    await call('POST', '/', JSON.stringify([{ type: 'Company', queueId: 'q-root' }]))
    const { events } = await (await call('GET', '/hook/default/events')).json()
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].body[0].queueId).toBe('q-root')
  })

  it('accepts a POST to any other path too, rather than dropping the delivery', async () => {
    expect((await call('POST', '/callbacks', JSON.stringify({ n: 1 }))).status).toBe(200)
    expect((await call('POST', '/webhook/up2data', JSON.stringify({ n: 2 }))).status).toBe(200)
  })

  it('still serves the page on a GET', async () => {
    const res = await call('GET', '/nope')
    expect(res.status).toBe(404)
  })

  it('does not treat an auth POST as a callback', async () => {
    const before = (await call('GET', '/hook/default/events')).json()
    await anon('POST', '/auth/login', '{}')
    const after = await (await call('GET', '/hook/default/events')).json()
    expect(after.events.length).toBe((await before).events.length)
  })
})
