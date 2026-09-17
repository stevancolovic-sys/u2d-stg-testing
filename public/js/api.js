import { buildBody, buildQuery } from './request.js'
import { getBase } from './config.js'

export function resolveUrl(endpoint, state) {
  let url = getBase() + endpoint.path
  if (endpoint.method === 'GET') {
    const q = buildQuery(endpoint.fields, state)
    if (q) url += `?${q}`
  }
  return url
}

export async function callApi({ endpoint, state, token }) {
  const started = performance.now()
  const url = resolveUrl(endpoint, state)
  const init = { method: endpoint.method, headers: {} }

  if (endpoint.method !== 'GET') {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(buildBody(endpoint.fields, state))
  }
  // The API takes the raw JWT with no Bearer prefix.
  if (endpoint.auth && token) init.headers['Authorization'] = token

  try {
    const res = await fetch(url, init)
    const raw = await res.text()
    let body = null
    try {
      body = JSON.parse(raw)
    } catch {
      body = null
    }
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers),
      body,
      raw,
      elapsedMs: Math.round(performance.now() - started),
    }
  } catch (err) {
    // A rejected fetch is a transport or CORS failure, not an HTTP status.
    return {
      transportError: String(err && err.message ? err.message : err),
      elapsedMs: Math.round(performance.now() - started),
    }
  }
}
