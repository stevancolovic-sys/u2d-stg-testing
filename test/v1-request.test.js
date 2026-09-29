import { describe, it, expect } from 'vitest'
import { buildV1Url, buildV1Body, jsonErrors, missingV1Required } from '../public/js/v1-request.js'
import { v1ById } from '../public/js/v1-endpoints.js'

const BASE = 'https://api.staging.uptodata.io/v1'

describe('buildV1Url', () => {
  const batch = v1ById('batch-get')

  it('puts a path parameter into the path', () => {
    expect(buildV1Url(BASE, batch, { job_id: { value: 'job_123' } })).toBe(`${BASE}/batch/job_123`)
  })

  it('escapes a path parameter rather than trusting it', () => {
    expect(buildV1Url(BASE, batch, { job_id: { value: 'a/b?c' } })).toContain('a%2Fb%3Fc')
  })

  it('leaves the placeholder when a path parameter is empty, so validation can catch it', () => {
    expect(buildV1Url(BASE, batch, {})).toBe(`${BASE}/batch/{job_id}`)
  })

  it('appends only the query parameters that are switched on', () => {
    const results = v1ById('batch-results')
    const url = buildV1Url(BASE, results, {
      job_id: { value: 'j1' },
      cursor: { enabled: true, value: 'abc' },
      limit: { enabled: false, value: 50 },
    })
    expect(url).toBe(`${BASE}/batch/j1/results?cursor=abc`)
  })

  it('adds no question mark when nothing is switched on', () => {
    const results = v1ById('batch-results')
    expect(buildV1Url(BASE, results, { job_id: { value: 'j1' } })).toBe(`${BASE}/batch/j1/results`)
  })
})

describe('buildV1Body', () => {
  const enrich = v1ById('profiles-enrich')

  it('sends only what is filled in or switched on', () => {
    const body = buildV1Body(enrich, { url: { enabled: true, value: 'https://linkedin.com/in/a' } })
    expect(body).toEqual({ url: 'https://linkedin.com/in/a' })
  })

  it('omits an optional flag that is switched off, rather than sending false', () => {
    const body = buildV1Body(enrich, {
      url: { enabled: true, value: 'x' },
      with_full_skills_and_endorsements: { enabled: false, value: true },
    })
    expect('with_full_skills_and_endorsements' in body).toBe(false)
  })

  it('parses a json field into real JSON, not a string', () => {
    const search = v1ById('search-people')
    const body = buildV1Body(search, { filters: { value: '{"titles":["CTO"]}' } })
    expect(body.filters).toEqual({ titles: ['CTO'] })
  })

  it('drops a json field that will not parse, so nothing malformed is sent', () => {
    const search = v1ById('search-people')
    expect('filters' in buildV1Body(search, { filters: { value: '{oops' } })).toBe(false)
  })

  it('has no body at all for a GET', () => {
    expect(buildV1Body(v1ById('batch-get'), { job_id: { value: 'j1' } })).toBe(null)
  })

  it('never puts a path or query parameter in the body', () => {
    const results = v1ById('batch-results')
    const body = buildV1Body(results, { job_id: { value: 'j1' }, cursor: { enabled: true, value: 'c' } })
    expect(body).toBe(null)
  })
})

describe('jsonErrors', () => {
  const search = v1ById('search-people')

  it('names a json field that will not parse', () => {
    expect(jsonErrors(search, { filters: { value: '{oops' } })).toEqual(['filters'])
  })

  it('is happy with valid json, and with an empty box', () => {
    expect(jsonErrors(search, { filters: { value: '{"a":1}' } })).toEqual([])
    expect(jsonErrors(search, { filters: { value: '   ' } })).toEqual([])
  })

  it('ignores a box that is switched off', () => {
    const enrich = v1ById('profiles-enrich')
    const field = enrich.fields.find((f) => f.type === 'json')
    if (!field) return
    expect(jsonErrors(enrich, { [field.name]: { enabled: false, value: '{oops' } })).toEqual([])
  })
})

describe('missingV1Required', () => {
  it('names a required path parameter that is empty', () => {
    expect(missingV1Required(v1ById('batch-get'), {})).toEqual(['job_id'])
  })

  it('names a required body field that is empty', () => {
    expect(missingV1Required(v1ById('search-people'), {})).toContain('filters')
  })

  it('is quiet when everything required is there', () => {
    expect(missingV1Required(v1ById('batch-get'), { job_id: { value: 'j1' } })).toEqual([])
  })
})
