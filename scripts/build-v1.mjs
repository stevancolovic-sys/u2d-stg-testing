// Generates the v1 endpoint registry from the published OpenAPI document.
//
// Twenty-six operations with nested filter objects are not worth transcribing
// by hand: a typo becomes a request nobody can make, and the spec moves. This
// reads the spec and writes the registry, so the two cannot disagree.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const source = process.argv[2] || join(root, 'spec', 'v1.yaml')

const spec = YAML.parse(readFileSync(source, 'utf8'))

// Our form renders these; anything else becomes a JSON box so it is still
// callable rather than quietly missing.
function fieldFor(name, schema, required, example) {
  const base = { name, label: name, required: Boolean(required) }
  if (schema.description) base.hint = String(schema.description).replace(/\s+/g, ' ').trim()

  if (schema.enum) {
    return { ...base, type: 'number', choices: schema.enum.map((v) => ({ value: v, label: String(v) })) }
  }
  switch (schema.type) {
    case 'boolean':
      return { ...base, type: 'boolean', default: true }
    case 'integer':
    case 'number':
      return { ...base, type: 'number' }
    case 'array':
      if (schema.items?.type === 'string') return { ...base, type: 'tags' }
      return { ...base, type: 'json', default: example !== undefined ? JSON.stringify(example, null, 2) : '[]' }
    case 'object':
      return { ...base, type: 'json', default: example !== undefined ? JSON.stringify(example, null, 2) : '{}' }
    default:
      return { ...base, type: 'text' }
  }
}

const operations = []

for (const [path, ops] of Object.entries(spec.paths || {})) {
  for (const [method, op] of Object.entries(ops)) {
    if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue

    const content = op.requestBody?.content?.['application/json']
    const schema = content?.schema || {}
    const example = content?.example || {}
    const required = new Set(schema.required || [])

    const fields = []

    // Path and query parameters come first: they decide the address.
    for (const param of op.parameters || []) {
      const p = param.schema || {}
      fields.push({
        ...fieldFor(param.name, p, param.required || param.in === 'path', undefined),
        in: param.in,
      })
    }

    for (const [name, prop] of Object.entries(schema.properties || {})) {
      fields.push({ ...fieldFor(name, prop, required.has(name), example[name]), in: 'body' })
    }

    operations.push({
      id: op.operationId,
      group: (op.tags || ['Other'])[0],
      label: op.summary || op.operationId,
      method: method.toUpperCase(),
      path,
      summary: (op.description || op.summary || '').replace(/\s+/g, ' ').trim(),
      fields,
    })
  }
}

const out = `// GENERATED from the published OpenAPI document — do not edit by hand.
// Rebuild with: npm run build:v1
//
// ${spec.info?.title || 'v1'} ${spec.info?.version || ''}
// Authenticated with an X-API-Key header, which the Worker adds; the key
// never reaches the browser.

export const V1_BASES = {
  staging: 'https://api.staging.uptodata.io/v1',
  production: 'https://api.uptodata.io/v1',
}

export const V1_ENDPOINTS = ${JSON.stringify(operations, null, 2)}

export const v1ById = (id) => V1_ENDPOINTS.find((e) => e.id === id) || null

export const V1_GROUPS = [...new Set(V1_ENDPOINTS.map((e) => e.group))]
`

const target = join(root, 'public', 'js', 'v1-endpoints.js')
writeFileSync(target, out)

const fieldCount = operations.reduce((n, o) => n + o.fields.length, 0)
console.log(`wrote ${target}`)
console.log(`  ${operations.length} operations, ${fieldCount} fields, ${[...new Set(operations.map((o) => o.group))].length} groups`)
