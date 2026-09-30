import { describe, it, expect } from 'vitest'
import {
  isSearch, searchOpsAmong, creditsOf, remainingAfter, reasonOf,
  budgetReached, summariseV1Run, planRun, ratesOver, lastsFor,
} from '../public/js/v1-load.js'
import { v1ById } from '../public/js/v1-endpoints.js'

const answered = (operationId, overrides = {}) => ({
  operationId,
  startedAt: 0,
  finishedAt: 2000,
  result: {
    ok: true,
    status: 200,
    body: { data: {}, meta: { creditsUsed: 2, creditsRemaining: 1000, billed: true, reason: 'profile_found' } },
    ...overrides,
  },
})

describe('isSearch', () => {
  it('knows which operations are rate limited by the hour', () => {
    expect(isSearch(v1ById('search-people'))).toBe(true)
    expect(isSearch(v1ById('search-people-sales-nav'))).toBe(true)
    expect(isSearch(v1ById('search-jobs'))).toBe(true)
    expect(isSearch(v1ById('profiles-enrich'))).toBe(false)
    expect(isSearch(v1ById('account-get'))).toBe(false)
  })

  it('picks the search operations out of a selection', () => {
    const picked = searchOpsAmong(['profiles-enrich', 'search-people', 'search-jobs'])
    expect(picked).toEqual(['search-jobs', 'search-people'])
  })

  it('survives nonsense', () => {
    expect(isSearch(null)).toBe(false)
    expect(searchOpsAmong([])).toEqual([])
  })
})

describe('creditsOf', () => {
  it('reads what the API says it charged', () => {
    expect(creditsOf({ body: { meta: { creditsUsed: 4, billed: true } } })).toBe(4)
  })

  it('is zero when the API says it did not bill', () => {
    expect(creditsOf({ body: { meta: { billed: false, creditsUsed: 0 } } })).toBe(0)
    expect(creditsOf({ body: { meta: { billed: false } } })).toBe(0)
  })

  it('admits it does not know rather than guessing zero', () => {
    expect(creditsOf({ body: { data: {} } })).toBe(null)
    expect(creditsOf({ transportError: 'failed' })).toBe(null)
    expect(creditsOf(null)).toBe(null)
  })

  it('reads the running balance where the API gives one', () => {
    expect(remainingAfter({ body: { meta: { creditsRemaining: 98417 } } })).toBe(98417)
    expect(remainingAfter({ body: { meta: {} } })).toBe(null)
  })
})

describe('reasonOf', () => {
  it('uses the API\'s own word', () => {
    expect(reasonOf({ body: { meta: { reason: 'unprocessable_target' } } })).toBe('unprocessable_target')
    expect(reasonOf({ body: { error: { type: 'invalid_request' } } })).toBe('invalid_request')
  })

  it('names a transport failure as one', () => {
    expect(reasonOf({ transportError: 'x' })).toBe('never reached the API')
  })

  it('falls back to the status when nothing else is said', () => {
    expect(reasonOf({ status: 503 })).toBe('status 503')
    expect(reasonOf({})).toBe('unknown')
  })
})

describe('budgetReached', () => {
  it('stops at the budget, not past it', () => {
    expect(budgetReached(499, 500)).toBe(false)
    expect(budgetReached(500, 500)).toBe(true)
    expect(budgetReached(501, 500)).toBe(true)
  })

  it('treats no budget as no limit', () => {
    expect(budgetReached(1e6, 0)).toBe(false)
    expect(budgetReached(1e6, undefined)).toBe(false)
  })
})

describe('planRun', () => {
  it('gives every operation a turn before any gets a second', () => {
    expect(planRun(['a', 'b'], 2).map((p) => p.operationId)).toEqual(['a', 'b', 'a', 'b'])
  })

  it('plans nothing for nothing', () => {
    expect(planRun([], 5)).toEqual([])
    expect(planRun(['a'], 0)).toEqual([])
  })
})

describe('ratesOver', () => {
  // Ten calls in the last ten seconds, two credits each.
  const recent = Array.from({ length: 10 }, (_, i) => ({
    operationId: 'profiles-enrich',
    startedAt: 90000 + i * 1000,
    finishedAt: 90500 + i * 1000,
    result: { ok: true, body: { meta: { creditsUsed: 2, billed: true } } },
  }))

  it('scales a partly filled window instead of reporting a rate too low', () => {
    const r = ratesOver(recent, 100000)
    // Ten calls across ten seconds is sixty a minute, not ten.
    expect(r.perMinute).toBe(60)
    expect(r.creditsPerMinute).toBe(120)
    expect(r.sampled).toBe(10)
  })

  it('ignores anything older than the window', () => {
    const old = [{ operationId: 'x', startedAt: 0, finishedAt: 1000, result: { body: { meta: { creditsUsed: 99 } } } }]
    const r = ratesOver([...old, ...recent], 100000)
    expect(r.creditsPerMinute).toBe(120)
  })

  it('reports nothing when nothing has finished', () => {
    expect(ratesOver([], 1000)).toEqual({ perMinute: 0, creditsPerMinute: 0, window: 60000, sampled: 0 })
  })

  it('does not count a reply that reported no cost as free', () => {
    const unknown = [{ operationId: 'x', startedAt: 95000, finishedAt: 96000, result: { body: {} } }]
    expect(ratesOver(unknown, 100000).creditsPerMinute).toBe(0)
  })
})

describe('lastsFor', () => {
  it('reads in the unit that suits the runway', () => {
    expect(lastsFor(600, 120)).toBe('5 min')
    expect(lastsFor(36000, 120)).toBe('5.0 h')
    expect(lastsFor(532000, 120)).toBe('3 days')
  })

  it('says nothing rather than dividing by zero', () => {
    expect(lastsFor(1000, 0)).toBe(null)
    expect(lastsFor(null, 100)).toBe(null)
    expect(lastsFor(0, 100)).toBe(null)
  })
})

describe('summariseV1Run', () => {
  const run = [
    answered('profiles-enrich'),
    answered('profiles-enrich', { body: { meta: { creditsUsed: 4, creditsRemaining: 996, billed: true, reason: 'profile_found' } } }),
    answered('companies-enrich', {
      ok: false,
      status: 422,
      body: { error: { type: 'unprocessable_target' }, meta: { creditsUsed: 1, creditsRemaining: 995, billed: true, reason: 'unprocessable_target' } },
    }),
    answered('search-people', {
      ok: false,
      status: 429,
      body: { error: { type: 'rate_limited' }, meta: { billed: false, creditsRemaining: 995 } },
    }),
  ]

  it('sums what was actually spent, not what was guessed', () => {
    const s = summariseV1Run(run, 500)
    expect(s.credits).toBe(7)
    expect(s.sent).toBe(4)
    expect(s.succeeded).toBe(2)
    expect(s.failed).toBe(2)
  })

  it('carries the balance the API last reported', () => {
    expect(summariseV1Run(run, 500).creditsRemaining).toBe(995)
  })

  it('breaks the spend down by operation, dearest first', () => {
    const s = summariseV1Run(run, 500)
    expect(s.operations[0].operationId).toBe('profiles-enrich')
    expect(s.operations[0].credits).toBe(6)
    expect(s.operations[0].sent).toBe(2)
  })

  it('gives each operation the API\'s own reasons', () => {
    const s = summariseV1Run(run, 500)
    const company = s.operations.find((o) => o.operationId === 'companies-enrich')
    expect(company.reasons[0]).toEqual({ reason: 'unprocessable_target', count: 1 })
  })

  it('counts a reply that reported no cost as unknown, not free', () => {
    const s = summariseV1Run([...run, answered('jobs-enrich', { body: { data: {} } })], 500)
    expect(s.unknownCost).toBe(1)
    expect(s.credits).toBe(7)
  })

  it('says when the budget was what stopped it', () => {
    expect(summariseV1Run(run, 5).stoppedOnBudget).toBe(true)
    expect(summariseV1Run(run, 500).stoppedOnBudget).toBe(false)
  })

  it('reports nothing for an empty run without falling over', () => {
    const s = summariseV1Run([], 100)
    expect(s.sent).toBe(0)
    expect(s.credits).toBe(0)
    expect(s.operations).toEqual([])
    expect(s.creditsRemaining).toBe(null)
  })
})
