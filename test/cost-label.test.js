import { describe, it, expect } from 'vitest'
import { ENDPOINTS, byId } from '../public/js/endpoints.js'
import { costLabel } from '../docs-src/cost-label.js'

describe('costLabel', () => {
  it('describes every endpoint without throwing', () => {
    for (const e of ENDPOINTS) {
      const label = costLabel(e)
      expect(typeof label, e.id).toBe('string')
      expect(label.length, e.id).toBeGreaterThan(3)
    }
  })

  it('calls the free endpoints free, and nothing else', () => {
    for (const e of ENDPOINTS) {
      expect(costLabel(e) === 'Free.', e.id).toBe(!e.credits)
    }
  })

  it('reads the real rates out of the formulas', () => {
    expect(costLabel(byId('companies-bulk'))).toBe('1 credit per company.')
    expect(costLabel(byId('latest-post'))).toBe('5 credits per profile.')
    expect(costLabel(byId('post-by-url'))).toBe('1 credit per post URL.')
  })

  it('names both profile flags and says they do not stack', () => {
    const label = costLabel(byId('profiles-bulk'))
    expect(label).toContain('1 credit per profile')
    expect(label).toContain('2 with withFollowersAndConnections or withFullSkillsAndEndorsements')
    expect(label).toContain('does not stack')
  })

  it('describes a search reservation as a reservation', () => {
    const label = costLabel(byId('search'))
    expect(label).toContain('3 credits reserved per result')
    expect(label).toContain('refunded')
  })

  it('prices partial searches at the base rate', () => {
    expect(costLabel(byId('partial-sales-profiles'))).toContain('1 credit reserved per result')
    expect(costLabel(byId('partial-sales-companies'))).not.toContain('1 credits')
  })
})
