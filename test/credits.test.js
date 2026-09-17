import { describe, it, expect } from 'vitest'
import { ENDPOINTS, VISIBLE, byId } from '../public/js/endpoints.js'
import { estimateCredits } from '../public/js/credits.js'

const est = (id, state) => estimateCredits(byId(id), state)
const peopleLink = (extra = {}) => ({
  url: 'https://www.linkedin.com/sales/search/people?query=a',
  ...extra,
})
const companyLink = (extra = {}) => ({
  url: 'https://www.linkedin.com/sales/search/company?query=a',
  ...extra,
})

describe('registry', () => {
  it('covers all sixteen endpoints', () => {
    expect(ENDPOINTS.length).toBe(16)
  })

  it('hides the single-list activity endpoints from the rail', () => {
    expect(VISIBLE.length).toBe(13)
    for (const id of ['posts', 'comments', 'reactions']) {
      expect(VISIBLE.some((e) => e.id === id), id).toBe(false)
      expect(byId(id), id).toBeTruthy()
    }
  })

  it('routes activity to the endpoints its picker selected', () => {
    const route = (lists) => byId('activity').route({ lists: { value: lists } })
    expect(route(['posts', 'comments', 'reactions'])).toEqual(['activity'])
    expect(route(['comments', 'reactions'])).toEqual(['comments', 'reactions'])
    expect(route([])).toEqual([])
  })

  it('has unique ids', () => {
    expect(new Set(ENDPOINTS.map((e) => e.id)).size).toBe(ENDPOINTS.length)
  })

  it('requires auth everywhere except authenticate', () => {
    expect(byId('authenticate').auth).toBe(false)
    for (const e of ENDPOINTS.filter((e) => e.id !== 'authenticate')) {
      expect(e.auth, e.id).toBe(true)
    }
  })

  it('gives every field a name and a type', () => {
    for (const e of ENDPOINTS) {
      for (const field of e.fields) {
        expect(field.name, e.id).toBeTruthy()
        expect(field.type, `${e.id}.${field.name}`).toBeTruthy()
        expect(typeof field.required, `${e.id}.${field.name}`).toBe('boolean')
      }
    }
  })
})

describe('estimateCredits', () => {
  it('charges 1 per profile without the followers flag', () => {
    expect(est('profiles-bulk', { profiles: { value: 'a\nb\nc' } }).amount).toBe(3)
  })

  it('charges 2 per profile when the followers flag is checked and true', () => {
    expect(
      est('profiles-bulk', {
        profiles: { value: 'a\nb\nc' },
        withFollowersAndConnections: { enabled: true, value: true },
      }).amount
    ).toBe(6)
  })

  it('ignores the followers flag when it is unchecked', () => {
    expect(
      est('profiles-bulk', {
        profiles: { value: 'a\nb' },
        withFollowersAndConnections: { enabled: false, value: true },
      }).amount
    ).toBe(2)
  })

  it('charges 2 per profile for the full-skills flag, like the followers flag', () => {
    expect(
      est('profiles-bulk', {
        profiles: { value: 'a\nb\nc' },
        withFullSkillsAndEndorsements: { enabled: true, value: true },
      }).amount
    ).toBe(6)
  })

  it('does not stack the two profile flags', () => {
    expect(
      est('profiles-bulk', {
        profiles: { value: 'a\nb\nc' },
        withFollowersAndConnections: { enabled: true, value: true },
        withFullSkillsAndEndorsements: { enabled: true, value: true },
      }).amount
    ).toBe(6)
  })

  it('ignores the full-skills flag when it is unchecked', () => {
    expect(
      est('profiles-bulk', {
        profiles: { value: 'a\nb' },
        withFullSkillsAndEndorsements: { enabled: false, value: true },
      }).amount
    ).toBe(2)
  })

  it('charges 1 per company', () => {
    expect(est('companies-bulk', { companies: { value: 'a\nb\nc\nd' } }).amount).toBe(4)
  })

  it('charges 4 per profile when activity asks for all three lists', () => {
    const state = { profiles: { value: 'a\nb' }, lists: { value: ['posts', 'comments', 'reactions'] } }
    const r = est('activity', state)
    expect(r.amount).toBe(8)
    expect(r.note).toContain('1 request')
  })

  it('charges 2 per profile when activity asks for one list', () => {
    const r = est('activity', { profiles: { value: 'a\nb' }, lists: { value: ['comments'] } })
    expect(r.amount).toBe(4)
  })

  it('charges the same for two activity lists as for three, and says so', () => {
    const two = est('activity', { profiles: { value: 'a\nb' }, lists: { value: ['comments', 'reactions'] } })
    const three = est('activity', { profiles: { value: 'a\nb' }, lists: { value: ['posts', 'comments', 'reactions'] } })
    expect(two.amount).toBe(three.amount)
    expect(two.note).toContain('2 requests')
    expect(two.note).toContain('costs nothing extra')
  })

  it('costs nothing when no activity list is picked', () => {
    const r = est('activity', { profiles: { value: 'a\nb' }, lists: { value: [] } })
    expect(r.amount).toBe(0)
    expect(r.note).toContain('at least one list')
  })

  it('charges 2 per profile for posts, comments and reactions', () => {
    for (const id of ['posts', 'comments', 'reactions']) {
      expect(est(id, { profiles: { value: 'a\nb' } }).amount, id).toBe(4)
    }
  })

  it('charges 5 per profile for latest-post', () => {
    expect(est('latest-post', { profiles: { value: 'a\nb' } }).amount).toBe(10)
  })

  it('charges 1 per post url', () => {
    expect(est('post-by-url', { posts: { value: 'u1\nu2\nu3' } }).amount).toBe(3)
  })

  it('charges 2 for a live profile and 4 with the flag', () => {
    expect(est('profile', { profile: { value: 'x' } }).amount).toBe(2)
    expect(
      est('profile', {
        profile: { value: 'x' },
        withFollowersAndConnections: { enabled: true, value: true },
      }).amount
    ).toBe(4)
  })

  it('charges 4 for a live profile with full skills, and does not stack with followers', () => {
    const both = {
      profile: { value: 'x' },
      withFollowersAndConnections: { enabled: true, value: true },
      withFullSkillsAndEndorsements: { enabled: true, value: true },
    }
    expect(est('profile', { profile: { value: 'x' }, withFullSkillsAndEndorsements: { enabled: true, value: true } }).amount).toBe(4)
    expect(est('profile', both).amount).toBe(4)
  })

  it('does not offer the full-skills flag where the API does not accept it', () => {
    for (const id of ['companies-bulk', 'activity', 'latest-post', 'post-by-url', 'company', 'search', 'partial-sales-profiles', 'partial-sales-companies']) {
      const names = byId(id).fields.map((f) => f.name)
      expect(names.includes('withFullSkillsAndEndorsements'), id).toBe(false)
    }
  })

  it('leaves search priced on the followers flag alone', () => {
    const link = { url: 'https://www.linkedin.com/sales/search/people?query=a', limitEnabled: true, limit: 100 }
    expect(
      est('search', {
        salesNavigatorLinks: { value: [link] },
        withFullSkillsAndEndorsements: { enabled: true, value: true },
      }).amount
    ).toBe(300)
  })

  it('charges 2 for a live company', () => {
    expect(est('company', { company: { value: 'x' } }).amount).toBe(2)
  })

  it('reserves limit x 3 per search link', () => {
    const r = est('search', {
      salesNavigatorLinks: { value: [peopleLink({ limitEnabled: true, limit: 500 })] },
    })
    expect(r.amount).toBe(1500)
    expect(r.reserved).toBe(true)
  })

  it('reserves limit x 4 for a people link with the followers flag', () => {
    expect(
      est('search', {
        salesNavigatorLinks: { value: [peopleLink({ limitEnabled: true, limit: 500 })] },
        withFollowersAndConnections: { enabled: true, value: true },
      }).amount
    ).toBe(2000)
  })

  it('keeps company links at x3 even with the followers flag', () => {
    expect(
      est('search', {
        salesNavigatorLinks: { value: [companyLink({ limitEnabled: true, limit: 100 })] },
        withFollowersAndConnections: { enabled: true, value: true },
      }).amount
    ).toBe(300)
  })

  it('assumes the 2500 maximum when a people search limit is unchecked', () => {
    const r = est('search', { salesNavigatorLinks: { value: [peopleLink({ limitEnabled: false })] } })
    expect(r.amount).toBe(7500)
    expect(r.note).toContain('maximum')
  })

  it('assumes the 1000 maximum when a company search limit is unchecked', () => {
    expect(
      est('search', { salesNavigatorLinks: { value: [companyLink({ limitEnabled: false })] } }).amount
    ).toBe(3000)
  })

  it('sums multiple links', () => {
    expect(
      est('search', {
        salesNavigatorLinks: {
          value: [
            peopleLink({ limitEnabled: true, limit: 100 }),
            companyLink({ limitEnabled: true, limit: 50 }),
          ],
        },
      }).amount
    ).toBe(450)
  })

  it('charges limit x 1 for partial searches', () => {
    expect(
      est('partial-sales-profiles', {
        salesNavigatorLinks: { value: [peopleLink({ limitEnabled: true, limit: 250 })] },
      }).amount
    ).toBe(250)
    expect(
      est('partial-sales-companies', {
        salesNavigatorLinks: { value: [companyLink({ limitEnabled: false })] },
      }).amount
    ).toBe(1000)
  })

  it('never applies the followers flag to partial searches', () => {
    expect(
      est('partial-sales-profiles', {
        salesNavigatorLinks: { value: [peopleLink({ limitEnabled: true, limit: 100 })] },
        withFollowersAndConnections: { enabled: true, value: true },
      }).amount
    ).toBe(100)
  })

  it('marks search reservations as reserved and per-item costs as not', () => {
    expect(est('search', { salesNavigatorLinks: { value: [] } }).reserved).toBe(true)
    expect(est('profiles-bulk', { profiles: { value: 'a' } }).reserved).toBe(false)
  })

  it('returns null for free endpoints', () => {
    expect(est('status', {})).toBe(null)
    expect(est('list', {})).toBe(null)
    expect(est('authenticate', {})).toBe(null)
  })
})
