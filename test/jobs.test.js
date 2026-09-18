import { describe, it, expect } from 'vitest'
import { JOBS, jobById, modeOf, targetField, optionalFields } from '../public/js/jobs.js'
import { byId, ENDPOINTS } from '../public/js/endpoints.js'

describe('jobs', () => {
  it('every mode points at an endpoint that exists', () => {
    for (const job of JOBS) {
      for (const mode of job.modes) {
        expect(byId(mode.endpoint), `${job.id}/${mode.id}`).toBeTruthy()
      }
    }
  })

  it('names jobs and modes in the API\'s own words, so they are recognisable', () => {
    expect(JOBS.map((j) => j.title)).toEqual([
      'People',
      'Companies',
      'Activity',
      'Post by URL',
      'Search — People',
      'Search — Companies',
    ])
    expect(jobById('people').modes.map((m) => m.label)).toEqual(['Bulk', 'Live'])
    expect(jobById('companies').modes.map((m) => m.label)).toEqual(['Bulk', 'Live'])
    expect(jobById('activity').modes.map((m) => m.label)).toEqual(['Activity', 'Latest post'])
    expect(jobById('findPeople').modes.map((m) => m.label)).toEqual(['Partial', 'Full search'])
  })

  it('every job says what it is for and what it wants', () => {
    for (const job of JOBS) {
      expect(job.title, job.id).toBeTruthy()
      expect(job.blurb, job.id).toBeTruthy()
      expect(job.question, job.id).toBeTruthy()
      expect(job.modes.length, job.id).toBeGreaterThan(0)
      expect(job.linkTypes.length, job.id).toBeGreaterThan(0)
    }
  })

  it('every mode explains its trade-off, since that is the choice being made', () => {
    for (const job of JOBS) {
      for (const mode of job.modes) {
        expect(mode.label, `${job.id}/${mode.id}`).toBeTruthy()
        expect(mode.blurb, `${job.id}/${mode.id}`).toBeTruthy()
      }
    }
  })

  it('covers every endpoint a person would ask for', () => {
    const reachable = new Set(JOBS.flatMap((j) => j.modes.map((m) => m.endpoint)))
    // authenticate is the token bar; status and list are how a job is watched;
    // the single-list activity endpoints are reached through the activity picker.
    const notJobs = ['authenticate', 'status', 'list', 'posts', 'comments', 'reactions']
    for (const e of ENDPOINTS) {
      if (notJobs.includes(e.id)) continue
      expect(reachable.has(e.id), e.id).toBe(true)
    }
  })

  it('finds a job and falls back to its first mode', () => {
    expect(jobById('people').title).toBe('People')
    expect(jobById('nope')).toBe(null)
    expect(modeOf(jobById('people'), 'nonsense').id).toBe('batch')
    expect(modeOf(jobById('people'), 'now').id).toBe('now')
    expect(modeOf(null, 'x')).toBe(null)
  })
})

describe('targetField', () => {
  it('finds the list field for a batch endpoint', () => {
    expect(targetField(byId('profiles-bulk')).name).toBe('profiles')
    expect(targetField(byId('companies-bulk')).name).toBe('companies')
    expect(targetField(byId('post-by-url')).name).toBe('posts')
    expect(targetField(byId('search')).name).toBe('salesNavigatorLinks')
  })

  it('finds the single field for a live endpoint', () => {
    expect(targetField(byId('profile')).name).toBe('profile')
    expect(targetField(byId('company')).name).toBe('company')
  })

  it('resolves for every endpoint a job can reach', () => {
    for (const job of JOBS) {
      for (const mode of job.modes) {
        expect(targetField(byId(mode.endpoint)), `${job.id}/${mode.id}`).toBeTruthy()
      }
    }
  })
})

describe('optionalFields', () => {
  it('returns what a job does not ask about up front', () => {
    const names = optionalFields(byId('profiles-bulk')).map((f) => f.name)
    expect(names).toContain('withFollowersAndConnections')
    expect(names).toContain('webhookTags')
    expect(names).not.toContain('profiles')
    expect(names).not.toContain('name')
  })

  it('never includes a ui-only control', () => {
    expect(optionalFields(byId('activity')).some((f) => f.uiOnly)).toBe(false)
  })
})
