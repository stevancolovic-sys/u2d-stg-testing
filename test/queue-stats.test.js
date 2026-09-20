import { describe, it, expect } from 'vitest'
import { groupByDay, dayLabel, formatDuration, summariseQueue } from '../public/js/queue-stats.js'

const NOW = new Date('2026-09-20T12:00:00Z')
const at = (iso) => ({ id: iso, createdAt: iso })

describe('dayLabel', () => {
  it('names today and yesterday rather than dating them', () => {
    expect(dayLabel('2026-09-20', NOW)).toBe('Today')
    expect(dayLabel('2026-09-19', NOW)).toBe('Yesterday')
  })

  it('dates anything older, and adds the year only when it differs', () => {
    expect(dayLabel('2026-09-14', NOW)).toBe('14 Sep')
    expect(dayLabel('2025-12-02', NOW)).toBe('2 Dec 2025')
  })

  it('has something to say about a job with no date', () => {
    expect(dayLabel('unknown', NOW)).toBe('No date')
  })
})

describe('groupByDay', () => {
  it('groups jobs by the day they were created, newest day first', () => {
    const days = groupByDay(
      [at('2026-09-19T09:00:00Z'), at('2026-09-20T08:00:00Z'), at('2026-09-19T17:00:00Z')],
      NOW
    )
    expect(days.map((d) => d.label)).toEqual(['Today', 'Yesterday'])
    expect(days[0].count).toBe(1)
    expect(days[1].count).toBe(2)
  })

  it('puts the newest job first within a day', () => {
    const days = groupByDay([at('2026-09-20T08:00:00Z'), at('2026-09-20T11:00:00Z')], NOW)
    expect(days[0].queues.map((q) => q.id)).toEqual(['2026-09-20T11:00:00Z', '2026-09-20T08:00:00Z'])
  })

  it('does not lose a job with an unreadable date', () => {
    const days = groupByDay([at('2026-09-20T08:00:00Z'), { id: 'x', createdAt: 'nonsense' }], NOW)
    expect(days.flatMap((d) => d.queues).length).toBe(2)
    expect(days.some((d) => d.label === 'No date')).toBe(true)
  })

  it('handles nothing at all', () => {
    expect(groupByDay([], NOW)).toEqual([])
    expect(groupByDay(null, NOW)).toEqual([])
  })
})

describe('formatDuration', () => {
  it('reads in the unit that suits the length', () => {
    expect(formatDuration(8000)).toBe('8s')
    expect(formatDuration(95000)).toBe('1m 35s')
    expect(formatDuration(120000)).toBe('2m')
    expect(formatDuration(4500000)).toBe('1h 15m')
  })

  it('says nothing rather than guessing', () => {
    expect(formatDuration(undefined)).toBe('—')
    expect(formatDuration(-5)).toBe('—')
  })
})

describe('summariseQueue', () => {
  const queue = {
    createdAt: '2026-09-20T10:00:00Z',
    finishedAt: '2026-09-20T10:04:00Z',
    submitted: 152,
    enqueued: 149,
    skipped: { invalid: 1, duplicates: 2 },
    processed: 149,
    total: 149,
    returned: 145,
  }

  it('reports what was sent, what was charged, and what came back', () => {
    const s = summariseQueue(queue)
    expect(s.submitted).toBe(152)
    expect(s.invalid).toBe(1)
    expect(s.duplicates).toBe(2)
    expect(s.enqueued).toBe(149)
    expect(s.returned).toBe(145)
  })

  it('names the gap between charged and returned', () => {
    expect(summariseQueue(queue).missing).toBe(4)
  })

  it('does not claim a gap before the results have been counted', () => {
    expect(summariseQueue({ ...queue, returned: undefined }).missing).toBe(null)
  })

  it('never reports a negative gap when more came back than expected', () => {
    expect(summariseQueue({ ...queue, returned: 200 }).missing).toBe(0)
  })

  it('times a finished job from creation to completion', () => {
    const s = summariseQueue(queue)
    expect(s.duration).toBe('4m')
    expect(s.finished).toBe(true)
    expect(s.perItemMs).toBe(Math.round(240000 / 149))
  })

  it('times a running job up to now', () => {
    const running = { ...queue, finishedAt: undefined }
    const s = summariseQueue(running, new Date('2026-09-20T10:01:30Z').getTime())
    expect(s.duration).toBe('1m 30s')
    expect(s.finished).toBe(false)
  })

  it('works out what was submitted when only the parts are known', () => {
    const s = summariseQueue({ ...queue, submitted: undefined })
    expect(s.submitted).toBe(152)
  })

  it('survives a queue from before any of this was recorded', () => {
    const s = summariseQueue({ createdAt: '2026-09-18T10:00:00Z', total: 5, processed: 5 })
    expect(s.enqueued).toBe(5)
    expect(s.returned).toBe(null)
    expect(s.missing).toBe(null)
  })
})
