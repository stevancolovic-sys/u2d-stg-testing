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
