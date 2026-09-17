import { describe, it, expect } from 'vitest'
import { buildBody, buildQuery, parseLines, toCurl } from '../public/js/request.js'

const fields = [
  { name: 'name', type: 'text', required: true },
  { name: 'profiles', type: 'lines', required: true },
  { name: 'priority', type: 'number', required: true },
  { name: 'withFollowersAndConnections', type: 'boolean', required: false },
  { name: 'webhookTags', type: 'tags', required: false },
]

const base = { name: { value: 'Job' }, profiles: { value: 'a' }, priority: { value: 2 } }

describe('buildBody', () => {
  it('includes required fields', () => {
    expect(buildBody(fields, { ...base, profiles: { value: 'a\nb' } })).toEqual({
      name: 'Job',
      profiles: ['a', 'b'],
      priority: 2,
    })
  })

  it('omits an unchecked optional boolean entirely', () => {
    const body = buildBody(fields, {
      ...base,
      withFollowersAndConnections: { enabled: false, value: true },
    })
    expect('withFollowersAndConnections' in body).toBe(false)
  })

  it('sends false when the optional boolean is checked and set to false', () => {
    const body = buildBody(fields, {
      ...base,
      withFollowersAndConnections: { enabled: true, value: false },
    })
    expect(body.withFollowersAndConnections).toBe(false)
  })

  it('keeps webhookTags as an empty array when checked and empty', () => {
    const body = buildBody(fields, { ...base, webhookTags: { enabled: true, value: [] } })
    expect(body.webhookTags).toEqual([])
  })

  it('coerces number fields out of string inputs', () => {
    expect(buildBody(fields, { ...base, priority: { value: '1' } }).priority).toBe(1)
  })

  it('builds salesNavigatorLinks and omits an unchecked per-link limit', () => {
    const linkFields = [{ name: 'salesNavigatorLinks', type: 'links', required: true }]
    const body = buildBody(linkFields, {
      salesNavigatorLinks: {
        value: [
          { url: 'u1', limitEnabled: true, limit: '500' },
          { url: 'u2', limitEnabled: false, limit: '' },
        ],
      },
    })
    expect(body.salesNavigatorLinks).toEqual([{ url: 'u1', limit: 500 }, { url: 'u2' }])
  })
})

describe('buildQuery', () => {
  const qFields = [
    { name: 'queueId', type: 'text', required: true },
    { name: 'page', type: 'number', required: true },
    { name: 'limit', type: 'number', required: true },
    { name: 'failed', type: 'boolean', required: false },
  ]
  const qBase = { queueId: { value: 'q1' }, page: { value: 0 }, limit: { value: 10 } }

  it('builds required params', () => {
    expect(buildQuery(qFields, qBase)).toBe('queueId=q1&page=0&limit=10')
  })

  it('omits an unchecked optional param', () => {
    expect(buildQuery(qFields, { ...qBase, failed: { enabled: false, value: true } })).not.toContain(
      'failed'
    )
  })

  it('includes a checked optional param', () => {
    expect(buildQuery(qFields, { ...qBase, failed: { enabled: true, value: true } })).toContain(
      'failed=true'
    )
  })
})

describe('parseLines', () => {
  it('trims and drops blank lines', () => {
    expect(parseLines(' a \n\n b \n')).toEqual(['a', 'b'])
  })
})

describe('toCurl', () => {
  it('emits the raw token with no Bearer prefix', () => {
    const cmd = toCurl({ method: 'POST', url: 'https://x/y', token: 'TK', body: { a: 1 } })
    expect(cmd).toContain("-H 'Authorization: TK'")
    expect(cmd).not.toContain('Bearer')
  })
})
