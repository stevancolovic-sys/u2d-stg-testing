// API keys, held by the Worker against the signed-in account.
//
// The key never reaches the browser: the console asks for a token and gets a
// token. A key does not expire, a token does, so the token is minted again
// whenever it is missing or refused — which is why nobody has to sign in to
// the API by hand.

import { PRESETS, getBase, presetFor } from './config.js'

// Which of the two APIs the base URL points at. A base nobody recognises has
// no stored key, and saying so beats quietly using the wrong one.
export function currentEnvironment() {
  const preset = presetFor(getBase())
  return preset ? preset.id : null
}

export const environmentLabel = (id) => PRESETS.find((p) => p.id === id)?.label || 'Custom API'

async function json(path, options) {
  const res = await fetch(path, options)
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // The Worker sends "error" for the headline and "detail" for what
    // actually went wrong. Dropping the detail left the panel saying only
    // that something failed, which is the part nobody needed telling.
    const headline = (body && (body.error || body.message)) || `${path} returned ${res.status}`
    const err = new Error(body && body.detail ? `${headline} ${body.detail}` : headline)
    err.status = res.status
    err.code = body && body.error
    throw err
  }
  return body
}

// Two APIs, two deployments each — four slots, each with its own key.
export const APIS = [
  {
    id: 'legacy',
    label: 'Legacy',
    note: 'Exchanged for a 24-hour token behind the scenes.',
    bases: {
      staging: 'https://api.staging.uptodata.io/api',
      production: 'https://api.uptodata.io/api',
    },
  },
  {
    id: 'v1',
    label: 'v1',
    note: 'Sent as an X-API-Key header by the tool, never by the browser.',
    bases: {
      staging: 'https://api.staging.uptodata.io/v1',
      production: 'https://api.uptodata.io/v1',
    },
  },
]

export const loadKeys = () => json('/keys').then((d) => d.keys)

export const saveKey = (api, environment, apiKey) =>
  json('/keys', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api, environment, apiKey }),
  }).then((d) => d.keys)

export const forgetKey = (api, environment) =>
  json(`/keys?api=${encodeURIComponent(api)}&environment=${encodeURIComponent(environment)}`, {
    method: 'DELETE',
  }).then((d) => d.keys)

// --- tokens --------------------------------------------------------------

const tokens = new Map()

export function clearToken(environment = currentEnvironment()) {
  tokens.delete(environment)
}

// Returns null when there is no key to mint from, so callers can say what is
// missing rather than failing as if the API were down.
export async function tokenFor(environment = currentEnvironment()) {
  if (!environment) return null
  if (tokens.has(environment)) return tokens.get(environment)

  try {
    const { accessToken } = await json('/keys/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment }),
    })
    tokens.set(environment, accessToken)
    return accessToken
  } catch (err) {
    if (err.code === 'no_key') return null
    throw err
  }
}

// A token lasts a day and is minted again the moment it is refused, so the
// only thing that has to last is the key.
export async function freshToken(environment = currentEnvironment()) {
  clearToken(environment)
  return tokenFor(environment)
}
