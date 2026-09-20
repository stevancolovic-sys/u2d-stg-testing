import { describe, it, expect } from 'vitest'
import { classifyTransportFailure, SERVER_TIMEOUT_MS } from '../public/js/diagnose.js'

describe('classifyTransportFailure', () => {
  it('blames the server when the API answers a second call', () => {
    const r = classifyTransportFailure({ elapsedMs: 60600, probeOk: true })
    expect(r.reachable).toBe(true)
    expect(r.headline).toContain('timed out on the server')
    // 60.6s reads as 61, not 60 — the figure is the real wait, rounded.
    expect(r.detail).toContain('61 seconds')
    expect(r.detail).toContain('no CORS headers')
    expect(r.detail).toContain('not a network or CORS problem')
  })

  it('does not call it a timeout when it failed quickly', () => {
    const r = classifyTransportFailure({ elapsedMs: 300, probeOk: true })
    expect(r.reachable).toBe(true)
    expect(r.headline).toContain('failed on the server')
    expect(r.headline).not.toContain('timed out')
  })

  it('says the API is down when the second call fails too', () => {
    const r = classifyTransportFailure({ elapsedMs: 200, probeOk: false })
    expect(r.reachable).toBe(false)
    expect(r.headline).toContain('not answering at all')
    expect(r.detail).toContain('base URL')
  })

  it('admits it does not know when no probe was made', () => {
    const r = classifyTransportFailure({ elapsedMs: 500 })
    expect(r.reachable).toBe(null)
    expect(r.headline).toBe('Request never reached the API')
  })

  it('treats the threshold as the boundary it claims to be', () => {
    expect(classifyTransportFailure({ elapsedMs: SERVER_TIMEOUT_MS, probeOk: true }).headline).toContain('timed out')
    expect(classifyTransportFailure({ elapsedMs: SERVER_TIMEOUT_MS - 1, probeOk: true }).headline).not.toContain('timed out')
  })

  it('survives being told nothing', () => {
    expect(classifyTransportFailure().headline).toBeTruthy()
  })
})
