import { describe, it, expect } from 'vitest'
import YAML from 'yaml'
// The published document itself, not something the generator wrote — so this
// compares the registry against its source rather than against itself.
import specText from '../spec/v1.yaml?raw'
import { V1_ENDPOINTS, v1ById, V1_GROUPS, V1_BASES } from '../public/js/v1-endpoints.js'

const spec = YAML.parse(specText)

const specOps = []
for (const [path, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue
    specOps.push({ method: method.toUpperCase(), path, op })
  }
}

describe('the generated v1 registry', () => {
  it('carries every operation the spec defines', () => {
    expect(V1_ENDPOINTS.length).toBe(specOps.length)
    for (const { method, path, op } of specOps) {
      const ours = v1ById(op.operationId)
      expect(ours, `${method} ${path} is missing`).toBeTruthy()
      expect(ours.method, op.operationId).toBe(method)
      expect(ours.path, op.operationId).toBe(path)
    }
  })

  it('carries every request property, and marks the required ones', () => {
    for (const { op } of specOps) {
      const schema = op.requestBody?.content?.['application/json']?.schema
      if (!schema?.properties) continue
      const ours = v1ById(op.operationId)
      const names = ours.fields.filter((f) => f.in === 'body').map((f) => f.name)
      for (const property of Object.keys(schema.properties)) {
        expect(names, `${op.operationId} drops ${property}`).toContain(property)
      }
      for (const required of schema.required || []) {
        const field = ours.fields.find((f) => f.name === required)
        expect(field.required, `${op.operationId}.${required}`).toBe(true)
      }
    }
  })

  it('carries path and query parameters, and always requires a path one', () => {
    for (const { op } of specOps) {
      for (const param of op.parameters || []) {
        const field = v1ById(op.operationId).fields.find((f) => f.name === param.name)
        expect(field, `${op.operationId} drops ${param.name}`).toBeTruthy()
        expect(field.in).toBe(param.in)
        if (param.in === 'path') expect(field.required, `${op.operationId}.${param.name}`).toBe(true)
      }
    }
  })

  it('gives every field a type the form can render', () => {
    const renderable = ['text', 'number', 'boolean', 'tags', 'json']
    for (const e of V1_ENDPOINTS) {
      for (const f of e.fields) {
        expect(renderable, `${e.id}.${f.name} is ${f.type}`).toContain(f.type)
      }
    }
  })

  it('never leaves an operation without an id, a group or a label', () => {
    for (const e of V1_ENDPOINTS) {
      expect(e.id, JSON.stringify(e)).toBeTruthy()
      expect(e.group, e.id).toBeTruthy()
      expect(e.label, e.id).toBeTruthy()
    }
    expect(new Set(V1_ENDPOINTS.map((e) => e.id)).size).toBe(V1_ENDPOINTS.length)
  })

  it('groups them the way the spec tags them', () => {
    expect(V1_GROUPS).toEqual(['Profiles', 'Companies', 'Jobs', 'Posts', 'Search', 'Batch', 'Account'])
  })

  it('knows both bases, and they differ only by host', () => {
    expect(V1_BASES.staging).toBe('https://api.staging.uptodata.io/v1')
    expect(V1_BASES.production).toBe('https://api.uptodata.io/v1')
  })

  it('gives every operation something to fill in, or says it takes nothing', () => {
    // Sixteen of these once opened with an empty form: the spec marks almost
    // nothing required, so the example is what names the fields that matter.
    for (const e of V1_ENDPOINTS) {
      const primary = e.fields.filter((f) => f.primary)
      expect(primary.length > 0 || e.takesNothing, `${e.id} opens empty`).toBe(true)
    }
  })

  it('shows every field the spec example fills in', () => {
    for (const { op } of specOps) {
      const example = op.requestBody?.content?.['application/json']?.example
      if (!example) continue
      const ours = v1ById(op.operationId)
      for (const name of Object.keys(example)) {
        const field = ours.fields.find((f) => f.name === name)
        expect(field, `${op.operationId} drops ${name}`).toBeTruthy()
        expect(field.primary, `${op.operationId}.${name} is hidden`).toBe(true)
      }
    }
  })

  it('always shows a path parameter, since it is part of the address', () => {
    for (const { op } of specOps) {
      for (const param of (op.parameters || []).filter((p) => p.in === 'path')) {
        expect(v1ById(op.operationId).fields.find((f) => f.name === param.name).primary).toBe(true)
      }
    }
  })

  it('starts a text field at the example value, so it is ready to edit', () => {
    const enrich = v1ById('profiles-enrich')
    expect(enrich.fields.find((f) => f.name === 'url').default).toContain('linkedin.com/in/')
  })

  it('prefills a json field from the spec example rather than leaving it blank', () => {
    const search = v1ById('search-people') || V1_ENDPOINTS.find((e) => e.path === '/search/people')
    const filters = search.fields.find((f) => f.name === 'filters')
    expect(filters.type).toBe('json')
    expect(() => JSON.parse(filters.default)).not.toThrow()
  })

  // The spec's example picks one way to name the subject and the alternatives
  // fall under Options, so someone holding a post URL found only a urn box.
  it('shows every way of naming the subject, not just the one the example used', () => {
    const alternatives = ['url', 'urn', 'share_urn', 'linkedin_id', 'domain', 'public_id']
    for (const endpoint of V1_ENDPOINTS) {
      const ids = endpoint.fields.filter(
        (f) => f.in === 'body' && alternatives.includes(f.name)
      )
      if (!ids.some((f) => f.primary)) continue
      for (const field of ids) {
        expect(
          field.primary,
          `${endpoint.id}: "${field.name}" is hidden while a sibling identifier is shown`
        ).toBe(true)
      }
    }
  })

  it('marks the alternatives as one choice, so two are never sent at once', () => {
    const comments = v1ById('posts-engagement-comments')
    const group = comments.fields.find((f) => f.name === 'url').exclusiveGroup
    expect(group).toBeTruthy()
    for (const name of ['urn', 'share_urn']) {
      expect(comments.fields.find((f) => f.name === name).exclusiveGroup).toBe(group)
    }
    // Anything that is not a way of naming the subject stays independent.
    expect(comments.fields.find((f) => f.name === 'page').exclusiveGroup).toBeUndefined()
  })

  it('lets a post URL be entered on the engagement calls', () => {
    for (const id of [
      'posts-engagement-comments',
      'posts-engagement-reactions',
      'posts-engagement-reposts',
    ]) {
      const endpoint = v1ById(id)
      if (!endpoint) continue
      expect(endpoint.fields.find((f) => f.name === 'url').primary).toBe(true)
    }
  })
})
