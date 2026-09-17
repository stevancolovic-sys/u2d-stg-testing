// Builds the exact request body from form state.
//
// The one rule that matters: an optional field is included only when its
// checkbox is on. "Not sent" and "sent as false" are different requests to
// this API, and the difference costs credits.

export const parseLines = (text) =>
  String(text ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

function coerce(field, raw) {
  switch (field.type) {
    case 'lines':
      return Array.isArray(raw) ? raw : parseLines(raw)
    case 'tags':
      return Array.isArray(raw) ? raw : parseLines(raw)
    case 'number':
      return raw === '' || raw === null || raw === undefined ? undefined : Number(raw)
    case 'boolean':
      return Boolean(raw)
    case 'links':
      return (raw || []).map((row) => {
        const link = { url: row.url }
        if (row.limitEnabled && row.limit !== '' && row.limit !== undefined && row.limit !== null) {
          link.limit = Number(row.limit)
        }
        return link
      })
    default:
      return raw
  }
}

// uiOnly fields steer the request without being part of it — the activity
// list picker decides which endpoints get called, not what their body says.
const included = (field, entry) =>
  !field.uiOnly && (field.required || Boolean(entry && entry.enabled))

export function buildBody(fields, state) {
  const body = {}
  for (const field of fields) {
    const entry = state[field.name]
    if (!included(field, entry)) continue
    const value = coerce(field, entry ? entry.value : undefined)
    if (value === undefined) continue
    body[field.name] = value
  }
  return body
}

export function buildQuery(fields, state) {
  const params = []
  for (const field of fields) {
    const entry = state[field.name]
    if (!included(field, entry)) continue
    const value = coerce(field, entry ? entry.value : undefined)
    if (value === undefined) continue
    params.push(`${encodeURIComponent(field.name)}=${encodeURIComponent(value)}`)
  }
  return params.join('&')
}

export function toCurl({ method, url, token, body }) {
  const lines = [`curl -X ${method} '${url}'`]
  if (body) lines.push(`  -H 'Content-Type: application/json'`)
  // The API takes the raw JWT — no Bearer prefix.
  if (token) lines.push(`  -H 'Authorization: ${token}'`)
  if (body) lines.push(`  -d '${JSON.stringify(body, null, 2)}'`)
  return lines.join(' \\\n')
}
