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
