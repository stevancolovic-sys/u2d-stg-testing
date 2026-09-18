import { describe, it, expect } from 'vitest'
import { pickProfile, scheduleDelays, percentile, summarise } from '../public/js/burst.js'

describe('pickProfile', () => {
  it('cycles the list so a short list answers a long run', () => {
    const list = ['a', 'b', 'c']
    expect([0, 1, 2, 3, 4].map((i) => pickProfile(list, i))).toEqual(['a', 'b', 'c', 'a', 'b'])
  })

  it('returns null for an empty list', () => {
    expect(pickProfile([], 0)).toBe(null)
  })
})

describe('scheduleDelays', () => {
  it('spreads twenty requests across one second at 20/s', () => {
    const d = scheduleDelays(20, 20)
    expect(d.length).toBe(20)
    expect(d[0]).toBe(0)
    expect(d[1]).toBe(50)
    expect(d[19]).toBe(950)
  })

  it('fires everything at once when no rate is given', () => {
    expect(scheduleDelays(5, 0)).toEqual([0, 0, 0, 0, 0])
    expect(scheduleDelays(3, Infinity)).toEqual([0, 0, 0])
    expect(scheduleDelays(3, null)).toEqual([0, 0, 0])
  })

  it('paces slower rates correctly', () => {
    expect(scheduleDelays(3, 2)).toEqual([0, 500, 1000])
    expect(scheduleDelays(3, 0.5)).toEqual([0, 2000, 4000])
  })

  it('handles a zero or nonsense count', () => {
    expect(scheduleDelays(0, 10)).toEqual([])
    expect(scheduleDelays(-4, 10)).toEqual([])
  })
})

describe('percentile', () => {
  it('reads the middle and the tail', () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(percentile(v, 50)).toBe(50)
    expect(percentile(v, 95)).toBe(100)
  })

  it('survives one value and none', () => {
    expect(percentile([7], 95)).toBe(7)
    expect(percentile([], 50)).toBe(0)
  })
})

describe('summarise', () => {
  const run = [
    { seq: 0, status: 200, startedAt: 0, finishedAt: 100, headers: {} },
    { seq: 1, status: 200, startedAt: 50, finishedAt: 300, headers: {} },
    { seq: 2, status: 404, startedAt: 100, finishedAt: 260, headers: {} },
    { seq: 3, status: 429, startedAt: 150, finishedAt: 200, headers: { 'retry-after': '7' } },
    { seq: 4, status: 429, startedAt: 200, finishedAt: 240, headers: { 'retry-after': '6' } },
    { seq: 5, transportError: 'network down', startedAt: 250, finishedAt: 260 },
  ]

  it('counts every status, transport failures included', () => {
    const s = summarise(run, 2)
    expect(s.sent).toBe(6)
    expect(s.byStatus).toEqual({ 200: 2, 404: 1, 429: 2, 'transport error': 1 })
  })

  it('bills 200 and 404 only — a 429 is free', () => {
    const s = summarise(run, 2)
    expect(s.billed).toBe(3)
    expect(s.credits).toBe(6)
  })

  it('doubles the credits when the flags double the rate', () => {
    expect(summarise(run, 4).credits).toBe(12)
  })

  it('reports when the limiter first bit, and what it asked for', () => {
    const s = summarise(run, 2)
    expect(s.rateLimited).toBe(2)
    expect(s.firstRateLimitAfterMs).toBe(150)
    expect(s.retryAfterSeconds).toBe(7)
  })

  it('measures elapsed time and throughput across the run', () => {
    const s = summarise(run, 2)
    expect(s.elapsedMs).toBe(300)
    expect(s.throughput).toBe(20)
  })

  it('reports latency percentiles by nearest rank', () => {
    // durations sorted: 10, 40, 50, 100, 160, 250
    const s = summarise(run, 2)
    expect(s.p50).toBe(50)
    expect(s.p95).toBe(250)
  })

  it('ignores requests still in flight', () => {
    const s = summarise([...run, { seq: 6, startedAt: 400 }], 2)
    expect(s.sent).toBe(6)
  })

  it('notices when the limiter sent headers', () => {
    expect(summarise(run, 2).sawRateLimitHeaders).toBe(true)
  })

  it('notices when no rate-limit header arrived at all', () => {
    const quiet = [
      { seq: 0, status: 200, startedAt: 0, finishedAt: 100, headers: { 'content-type': 'application/json' } },
      { seq: 1, status: 200, startedAt: 10, finishedAt: 120, headers: {} },
    ]
    const s = summarise(quiet, 2)
    expect(s.sawRateLimitHeaders).toBe(false)
    expect(s.rateLimited).toBe(0)
  })

  it('says nothing happened for an empty run', () => {
    const s = summarise([], 2)
    expect(s.sent).toBe(0)
    expect(s.credits).toBe(0)
    expect(s.firstRateLimitAfterMs).toBe(null)
    expect(s.retryAfterSeconds).toBe(null)
  })
})
