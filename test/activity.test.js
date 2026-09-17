import { describe, it, expect } from 'vitest'
import { ACTIVITY_LISTS, normalizeSelection, routeActivity, activityCredits } from '../public/js/activity.js'

describe('normalizeSelection', () => {
  it('returns lists in a fixed order regardless of tick order', () => {
    expect(normalizeSelection(['reactions', 'posts'])).toEqual(['posts', 'reactions'])
  })

  it('drops anything that is not a list', () => {
    expect(normalizeSelection(['comments', 'nonsense'])).toEqual(['comments'])
  })

  it('handles an empty or missing selection', () => {
    expect(normalizeSelection([])).toEqual([])
    expect(normalizeSelection(undefined)).toEqual([])
  })
})

describe('routeActivity', () => {
  it('bundles all three into a single /activity request', () => {
    expect(routeActivity(ACTIVITY_LISTS)).toEqual(['activity'])
  })

  it('sends one request for one list', () => {
    expect(routeActivity(['comments'])).toEqual(['comments'])
  })

  it('sends one request per list for two lists — never /activity', () => {
    expect(routeActivity(['comments', 'reactions'])).toEqual(['comments', 'reactions'])
    expect(routeActivity(['reactions', 'posts'])).toEqual(['posts', 'reactions'])
  })

  it('sends nothing when nothing is selected', () => {
    expect(routeActivity([])).toEqual([])
  })
})

describe('activityCredits', () => {
  it('charges 2 per profile for one list', () => {
    const c = activityCredits(['comments'], 10)
    expect(c.perProfile).toBe(2)
    expect(c.amount).toBe(20)
    expect(c.requests).toBe(1)
    expect(c.thirdIsFree).toBe(false)
  })

  it('charges 4 per profile for two lists, across two requests', () => {
    const c = activityCredits(['comments', 'reactions'], 10)
    expect(c.perProfile).toBe(4)
    expect(c.amount).toBe(40)
    expect(c.requests).toBe(2)
    expect(c.bundled).toBe(false)
    expect(c.thirdIsFree).toBe(true)
  })

  it('charges 4 per profile for all three — the same as two, in one request', () => {
    const c = activityCredits(ACTIVITY_LISTS, 10)
    expect(c.perProfile).toBe(4)
    expect(c.amount).toBe(40)
    expect(c.requests).toBe(1)
    expect(c.bundled).toBe(true)
    expect(c.thirdIsFree).toBe(false)
  })

  it('never charges 6 — three lists always bundle', () => {
    expect(activityCredits(ACTIVITY_LISTS, 1).perProfile).toBe(3 * 2 - 2)
    expect(activityCredits(ACTIVITY_LISTS, 1).perProfile).toBe(4)
  })

  it('costs nothing when nothing is selected', () => {
    const c = activityCredits([], 10)
    expect(c.amount).toBe(0)
    expect(c.requests).toBe(0)
  })
})
