import { describe, it, expect } from 'vitest'
import { planCards, shouldAutoLoadResults } from '../public/js/queue-plan.js'

const q = (id, extra = {}) => ({ id, ...extra })

describe('planCards', () => {
  it('creates a card for a queue it has never seen', () => {
    const plan = planCards([], [q('a'), q('b')])
    expect(plan.create).toEqual(['a', 'b'])
    expect(plan.update).toEqual([])
    expect(plan.remove).toEqual([])
  })

  it('updates rather than recreates a card that already exists', () => {
    const plan = planCards(['a', 'b'], [q('a'), q('b')])
    expect(plan.create).toEqual([])
    expect(plan.update).toEqual(['a', 'b'])
    expect(plan.remove).toEqual([])
  })

  it('never recreates an existing card — that is what destroyed loaded results', () => {
    for (let tick = 0; tick < 5; tick++) {
      expect(planCards(['a'], [q('a')]).create).toEqual([])
    }
  })

  it('removes a card whose queue is gone', () => {
    const plan = planCards(['a', 'b'], [q('b')])
    expect(plan.remove).toEqual(['a'])
    expect(plan.update).toEqual(['b'])
  })

  it('handles a new queue arriving alongside existing ones', () => {
    const plan = planCards(['a'], [q('new'), q('a')])
    expect(plan.create).toEqual(['new'])
    expect(plan.update).toEqual(['a'])
    expect(plan.order).toEqual(['new', 'a'])
  })

  it('reports the order the cards should appear in', () => {
    expect(planCards(['b', 'a'], [q('a'), q('b')]).order).toEqual(['a', 'b'])
  })

  it('empties cleanly', () => {
    const plan = planCards(['a', 'b'], [])
    expect(plan.remove).toEqual(['a', 'b'])
    expect(plan.create).toEqual([])
  })
})

describe('shouldAutoLoadResults', () => {
  it('loads once a queue completes', () => {
    expect(shouldAutoLoadResults(q('a', { status: 'completed' }), false)).toBe(true)
  })

  it('does not load again on the next tick', () => {
    expect(shouldAutoLoadResults(q('a', { status: 'completed' }), true)).toBe(false)
  })

  it('waits while the queue is still pending', () => {
    expect(shouldAutoLoadResults(q('a', { status: 'pending' }), false)).toBe(false)
    expect(shouldAutoLoadResults(q('a', { status: null }), false)).toBe(false)
  })
})
