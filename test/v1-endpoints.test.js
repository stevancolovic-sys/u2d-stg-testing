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

  it('prefills a json field from the spec example rather than leaving it blank', () => {
    const search = v1ById('search-people') || V1_ENDPOINTS.find((e) => e.path === '/search/people')
    const filters = search.fields.find((f) => f.name === 'filters')
    expect(filters.type).toBe('json')
    expect(() => JSON.parse(filters.default)).not.toThrow()
  })
})
