import { describe, it, expect } from 'vitest'
import { pickProfile, scheduleDelays, percentile, summarise, reasonFor, runPool } from '../public/js/burst.js'

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

describe('runPool', () => {
  // Records how many tasks were running at once, so overlap is provable
  // rather than assumed.
  const tracker = () => {
    const state = { inFlight: 0, peak: 0, order: [] }
    const task = async (item) => {
      state.inFlight += 1
      state.peak = Math.max(state.peak, state.inFlight)
      state.order.push(item)
      await new Promise((r) => setTimeout(r, 5))
      state.inFlight -= 1
      return item * 10
    }
    return { state, task }
  }

  it('with a limit of 1, never runs two at once', async () => {
    const { state, task } = tracker()
    await runPool([1, 2, 3, 4, 5], 1, task)
    expect(state.peak).toBe(1)
  })

  it('with a limit of 1, issues them in order', async () => {
    const { state, task } = tracker()
    await runPool([1, 2, 3, 4], 1, task)
    expect(state.order).toEqual([1, 2, 3, 4])
  })

  it('keeps at most `limit` in flight', async () => {
    const { state, task } = tracker()
    await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, task)
    expect(state.peak).toBe(3)
  })

  it('returns results in input order however they finished', async () => {
    const out = await runPool([1, 2, 3], 3, async (n) => {
      await new Promise((r) => setTimeout(r, (4 - n) * 5))
      return n * 10
    })
    expect(out).toEqual([10, 20, 30])
  })

  it('never starts more workers than there are items', async () => {
    const { state, task } = tracker()
    await runPool([1], 10, task)
    expect(state.peak).toBe(1)
  })

  it('stops early when asked, leaving the rest unsent', async () => {
    const seen = []
    await runPool([1, 2, 3, 4, 5], 1, async (n) => {
      seen.push(n)
      return n
    }, () => seen.length >= 2)
    expect(seen).toEqual([1, 2])
  })

  it('treats a nonsense limit as one at a time', async () => {
    const { state, task } = tracker()
    await runPool([1, 2, 3], 0, task)
    expect(state.peak).toBe(1)
  })

  it('handles an empty list', async () => {
    expect(await runPool([], 3, async () => 1)).toEqual([])
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

  it('reports how many were asked for against how many went out', () => {
    const s = summarise(run, 2, 20)
    expect(s.requested).toBe(20)
    expect(s.sent).toBe(6)
  })

  it('falls back to what was sent when no total was given', () => {
    expect(summarise(run, 2).requested).toBe(6)
  })

  it('splits succeeded from not, and 404 does not count as success', () => {
    const s = summarise(run, 2, 6)
    expect(s.succeeded).toBe(2)
    expect(s.failed).toBe(4)
    expect(s.succeeded + s.failed).toBe(s.sent)
  })

  it('says why each group failed, biggest group first', () => {
    const s = summarise(run, 2, 6)
    expect(s.failures[0]).toEqual({
      status: 429,
      reason: 'rate limited by the team\u2019s shared window',
      count: 2,
    })
    expect(s.failures.map((f) => f.count)).toEqual([2, 1, 1])
    expect(s.failures.find((f) => f.status === 404).reason).toContain('still billed')
    expect(s.failures.find((f) => f.status === null).reason).toContain('never reached the API')
  })

  it('reports the mean duration alongside the percentiles', () => {
    // durations: 100, 250, 160, 50, 40, 10 — mean 101.67 -> 102
    expect(summarise(run, 2, 6).avgMs).toBe(102)
  })

  it('splits the average into server time and download time', () => {
    const timed = [
      { seq: 0, status: 200, startedAt: 0, finishedAt: 7033, waitingMs: 7001, downloadMs: 32, bytes: 4000, headers: {} },
      { seq: 1, status: 200, startedAt: 0, finishedAt: 3011, waitingMs: 2999, downloadMs: 12, bytes: 2000, headers: {} },
    ]
    const s = summarise(timed, 2, 2)
    expect(s.avgMs).toBe(5022)
    expect(s.avgWaitingMs).toBe(5000)
    expect(s.avgDownloadMs).toBe(22)
    expect(s.avgBytes).toBe(3000)
  })

  it('reports zero rather than NaN when timings are missing', () => {
    const s = summarise(run, 2, 6)
    expect(s.avgWaitingMs).toBe(0)
    expect(s.avgDownloadMs).toBe(0)
    expect(s.avgBytes).toBe(0)
  })

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
    expect(s.succeeded).toBe(0)
    expect(s.failed).toBe(0)
    expect(s.failures).toEqual([])
    expect(s.avgMs).toBe(0)
    expect(s.credits).toBe(0)
    expect(s.firstRateLimitAfterMs).toBe(null)
    expect(s.retryAfterSeconds).toBe(null)
  })
})

describe('reasonFor', () => {
  it('explains the statuses the API documents', () => {
    expect(reasonFor({ status: 200 })).toBe('enriched')
    expect(reasonFor({ status: 403 })).toContain('not enough credits')
    expect(reasonFor({ status: 503 })).toContain('retry later')
    expect(reasonFor({ status: 401 })).toContain('expired')
  })

  it('names a transport failure as one', () => {
    expect(reasonFor({ transportError: 'failed to fetch' })).toContain('never reached the API')
  })

  it('does not pretend to know an unfamiliar status', () => {
    expect(reasonFor({ status: 418 })).toBe('unexpected status 418')
  })
})
