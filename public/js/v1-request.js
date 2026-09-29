// Building a v1 request.
//
// v1 splits a call three ways: some values go into the path, some into the
// query string, the rest into the body. The legacy builder only knew about a
// body, so this is its own thing rather than a flag on the old one.

import { parseLines } from './request.js'

const included = (field, entry) => field.required || Boolean(entry && entry.enabled)

function coerce(field, raw) {
  switch (field.type) {
    case 'number':
      return raw === '' || raw === null || raw === undefined ? undefined : Number(raw)
    case 'boolean':
      return Boolean(raw)
    case 'tags':
      return Array.isArray(raw) ? raw : parseLines(raw)
    case 'json':
      try {
        const text = String(raw ?? '').trim()
        return text ? JSON.parse(text) : undefined
      } catch {
        return undefined
      }
    default: {
      const text = raw === null || raw === undefined ? '' : String(raw)
      return text.trim() === '' ? undefined : text
    }
  }
}

const fieldsIn = (endpoint, where) => endpoint.fields.filter((f) => (f.in || 'body') === where)

// Path parameters are part of the address, so a missing one is a broken URL
// rather than a missing field — it is left as its placeholder and caught by
// validation before anything is sent.
export function buildV1Url(base, endpoint, state) {
  let path = endpoint.path
  for (const field of fieldsIn(endpoint, 'path')) {
    const value = coerce(field, state[field.name]?.value)
    if (value === undefined) continue
    path = path.replace(`{${field.name}}`, encodeURIComponent(value))
  }

  const query = []
  for (const field of fieldsIn(endpoint, 'query')) {
    const entry = state[field.name]
    if (!included(field, entry)) continue
    const value = coerce(field, entry?.value)
    if (value === undefined) continue
    query.push(`${encodeURIComponent(field.name)}=${encodeURIComponent(value)}`)
  }

  return base + path + (query.length ? `?${query.join('&')}` : '')
}

export function buildV1Body(endpoint, state) {
  if (endpoint.method === 'GET') return null
  const body = {}
  for (const field of fieldsIn(endpoint, 'body')) {
    const entry = state[field.name]
    if (!included(field, entry)) continue
    const value = coerce(field, entry?.value)
    if (value === undefined) continue
    body[field.name] = value
  }
  return body
}

// A json box holding something that is not JSON would otherwise be dropped in
// silence, and the call would go out missing a filter nobody noticed.
export function jsonErrors(endpoint, state) {
  const bad = []
  for (const field of endpoint.fields) {
    if (field.type !== 'json') continue
    const entry = state[field.name]
    if (!included(field, entry)) continue
    const text = String(entry?.value ?? '').trim()
    if (!text) continue
    try {
      JSON.parse(text)
    } catch {
      bad.push(field.name)
    }
  }
  return bad
}

export function missingV1Required(endpoint, state) {
  const missing = []
  for (const field of endpoint.fields) {
    if (!field.required) continue
    const value = coerce(field, state[field.name]?.value)
    const empty =
      value === undefined ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'string' && !value.trim())
    if (empty) missing.push(field.name)
  }
  return missing
}
