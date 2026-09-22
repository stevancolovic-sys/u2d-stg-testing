import { describe, it, expect } from 'vitest'
import { JOBS, jobById, modeOf, targetField, optionalFields, otherRequiredFields, missingRequired, suggestedName } from '../public/js/jobs.js'
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

describe('otherRequiredFields', () => {
  it('returns the required fields a job does not ask about, so they get rendered', () => {
    const names = otherRequiredFields(byId('profiles-bulk')).map((f) => f.name)
    expect(names).toEqual(['name', 'priority'])
  })

  it('never includes the target itself', () => {
    for (const job of JOBS) {
      for (const mode of job.modes) {
        const e = byId(mode.endpoint)
        const target = targetField(e)
        expect(otherRequiredFields(e).map((f) => f.name), `${job.id}/${mode.id}`).not.toContain(target.name)
      }
    }
  })

  it('leaves every required field reachable somewhere in the UI', () => {
    for (const job of JOBS) {
      for (const mode of job.modes) {
        const e = byId(mode.endpoint)
        const rendered = new Set([
          targetField(e).name,
          ...otherRequiredFields(e).map((f) => f.name),
          ...optionalFields(e).map((f) => f.name),
        ])
        for (const field of e.fields) {
          if (field.uiOnly) continue
          expect(rendered.has(field.name), `${job.id}/${mode.id} drops ${field.name}`).toBe(true)
        }
      }
    }
  })
})

describe('name on queue endpoints', () => {
  it('is required on every endpoint that creates a queue', () => {
    // The docs call it optional on the activity and post endpoints; staging
    // answers 500 "Path `name` is required" when it is left out.
    const creates = [
      'profiles-bulk', 'companies-bulk',
      'activity', 'posts', 'comments', 'reactions',
      'latest-post', 'post-by-url',
      'search', 'partial-sales-profiles', 'partial-sales-companies',
    ]
    for (const id of creates) {
      const field = byId(id).fields.find((f) => f.name === 'name')
      expect(field, `${id} has no name field`).toBeTruthy()
      expect(field.required, `${id} must treat name as required`).toBe(true)
    }
  })

  it('therefore never hides name under Options', () => {
    for (const job of JOBS) {
      for (const mode of job.modes) {
        const e = byId(mode.endpoint)
        if (!e.fields.some((f) => f.name === 'name')) continue
        expect(optionalFields(e).map((f) => f.name), `${job.id}/${mode.id}`).not.toContain('name')
        expect(otherRequiredFields(e).map((f) => f.name), `${job.id}/${mode.id}`).toContain('name')
      }
    }
  })
})

describe('missingRequired', () => {
  it('catches the empty name that made the API refuse the queue', () => {
    const state = { name: { value: '' }, profiles: { value: 'a' }, priority: { value: 2 } }
    expect(missingRequired(byId('profiles-bulk'), state)).toEqual(['name'])
  })

  it('is happy when everything required is filled in', () => {
    const state = { name: { value: 'Q1' }, profiles: { value: 'a' }, priority: { value: 2 } }
    expect(missingRequired(byId('profiles-bulk'), state)).toEqual([])
  })

  it('treats whitespace as empty', () => {
    const state = { name: { value: '   ' }, profiles: { value: 'a' }, priority: { value: 2 } }
    expect(missingRequired(byId('profiles-bulk'), state)).toEqual(['name'])
  })

  it('counts a links field with no url as missing', () => {
    const state = {
      name: { value: 'S' },
      priority: { value: 2 },
      salesNavigatorLinks: { value: [{ url: '  ', limitEnabled: false }] },
    }
    expect(missingRequired(byId('search'), state)).toEqual(['salesNavigatorLinks'])
  })

  it('ignores optional fields however empty they are', () => {
    const state = { name: { value: 'Q1' }, profiles: { value: 'a' }, priority: { value: 2 }, webhookTags: { value: '' } }
    expect(missingRequired(byId('profiles-bulk'), state)).toEqual([])
  })

  it('reports everything missing at once, not one at a time', () => {
    expect(missingRequired(byId('profiles-bulk'), {}).sort()).toEqual(['name', 'priority', 'profiles'])
  })
})

describe('suggestedName', () => {
  it('names a queue after the job and the day, so it is never empty', () => {
    expect(suggestedName(jobById('people'), new Date(2026, 8, 20))).toBe('People — 20 Sep')
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
