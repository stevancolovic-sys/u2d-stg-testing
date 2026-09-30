import { describe, it, expect } from 'vitest'
import {
  COMPANY_SEED, targetSlotFor, buildPools, nextTarget, runnable, KINDS,
} from '../public/js/targets.js'
import { v1ById, V1_ENDPOINTS } from '../public/js/v1-endpoints.js'

describe('targetSlotFor', () => {
  it('sends a profile to the profile operations', () => {
    expect(targetSlotFor(v1ById('profiles-enrich'))).toEqual({ kind: 'profile', field: 'url' })
    expect(targetSlotFor(v1ById('profiles-activity')).kind).toBe('profile')
  })

  it('sends a company to the company operations', () => {
    expect(targetSlotFor(v1ById('companies-enrich'))).toEqual({ kind: 'company', field: 'url' })
    expect(targetSlotFor(v1ById('companies-headcount')).kind).toBe('company')
  })

  it('addresses post engagement by urn and post enrich by url', () => {
    expect(targetSlotFor(v1ById('posts-engagement-comments'))).toEqual({ kind: 'post', field: 'urn' })
    expect(targetSlotFor(v1ById('posts-enrich'))).toEqual({ kind: 'post', field: 'url' })
  })

  it('gives search operations no target — their variety is in the filters', () => {
    for (const id of ['search-people', 'search-jobs', 'search-posts', 'search-companies-sales-nav']) {
      expect(targetSlotFor(v1ById(id)), id).toBe(null)
    }
  })

  it('has an answer for every operation the console can run', () => {
    for (const e of V1_ENDPOINTS) {
      const slot = targetSlotFor(e)
      if (slot) expect(KINDS, e.id).toContain(slot.kind)
    }
  })
})

describe('buildPools', () => {
  const saved = [
    { type: 'profile', url: 'ACoAAAFQVg8Bl5-CNIAKaZpnJnNUZp6WQul09V0' },
    { type: 'profile', url: 'https://www.linkedin.com/in/johndoe' },
    { type: 'company', url: 'https://www.linkedin.com/company/acme' },
    { type: 'leadSearch', url: 'https://www.linkedin.com/sales/search/people?query=a' },
  ]

  it('takes profiles from the saved links, urns included', () => {
    const pools = buildPools({ saved })
    expect(pools.profile).toEqual([
      'ACoAAAFQVg8Bl5-CNIAKaZpnJnNUZp6WQul09V0',
      'https://www.linkedin.com/in/johndoe',
    ])
  })

  it('falls back to real companies when none were supplied', () => {
    expect(buildPools({}).company).toEqual(COMPANY_SEED)
    expect(COMPANY_SEED.length).toBeGreaterThan(20)
    expect(COMPANY_SEED.every((u) => u.startsWith('https://www.linkedin.com/company/'))).toBe(true)
  })

  it('does not dilute a pasted list with the fallback', () => {
    const pools = buildPools({ pasted: { company: 'https://www.linkedin.com/company/mine' } })
    expect(pools.company).toEqual(['https://www.linkedin.com/company/mine'])
  })

  it('leaves posts and jobs empty rather than inventing targets that would bill', () => {
    const pools = buildPools({ saved })
    expect(pools.post).toEqual([])
    expect(pools.job).toEqual([])
  })

  it('drops duplicates so a round really is a round', () => {
    const pools = buildPools({ pasted: { post: 'a\nb\na' } })
    expect(pools.post).toEqual(['a', 'b'])
  })
})

describe('nextTarget', () => {
  it('cycles, so a target does not repeat until the pool has been round', () => {
    const pool = ['a', 'b', 'c']
    expect([0, 1, 2, 3, 4].map((i) => nextTarget(pool, i))).toEqual(['a', 'b', 'c', 'a', 'b'])
  })

  it('has nothing to give from an empty pool', () => {
    expect(nextTarget([], 0)).toBe(null)
    expect(nextTarget(null, 0)).toBe(null)
  })
})

describe('runnable', () => {
  it('names what cannot run and what it needs, rather than skipping it quietly', () => {
    const pools = buildPools({ saved: [{ type: 'profile', url: 'x' }] })
    const { ready, blocked } = runnable(
      ['profiles-enrich', 'posts-enrich', 'jobs-enrich', 'search-people'].map(v1ById),
      pools
    )
    expect(ready).toEqual(['profiles-enrich', 'search-people'])
    expect(blocked).toEqual([
      { id: 'posts-enrich', needs: 'post' },
      { id: 'jobs-enrich', needs: 'job' },
    ])
  })

  it('lets a search run with no pools at all', () => {
    expect(runnable([v1ById('search-people')], {}).ready).toEqual(['search-people'])
  })
})
