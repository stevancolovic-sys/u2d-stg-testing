import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import worker from '../src/worker.js'

async function call(method, path, body) {
  const req = new Request(`https://x${path}`, {
    method,
    body,
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
    const res = await call('POST', '/', JSON.stringify([{ type: 'Profile' }]))
    expect(res.status).toBe(200)
    const { links } = await (await call('GET', '/links')).json()
    expect(links.some((l) => l.type === 'Profile')).toBe(false)
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
})
