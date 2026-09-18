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

export async function callApi({ endpoint, state, token, timeoutMs }) {
  const started = performance.now()
  const url = resolveUrl(endpoint, state)
  const init = { method: endpoint.method, headers: {} }

  // Giving up on the answer does not stop the API working on it, and does not
  // refund the credits — the request is simply no longer being listened to.
  // That is exactly what a client with a 15 second timeout does.
  const controller = timeoutMs > 0 ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  if (controller) init.signal = controller.signal

  if (endpoint.method !== 'GET') {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(buildBody(endpoint.fields, state))
  }
  // The API takes the raw JWT with no Bearer prefix.
  if (endpoint.auth && token) init.headers['Authorization'] = token

  try {
    // fetch resolves when the response HEADERS arrive, so this split says how
    // much of the wait was the server working and how much was moving bytes.
    // The finer breakdown (DNS, TCP, TTFB) needs a Timing-Allow-Origin header
    // the API does not send, so this is as far as a browser can see.
    const res = await fetch(url, init)
    const headersAt = performance.now()

    const raw = await res.text()
    const doneAt = performance.now()

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
      elapsedMs: Math.round(doneAt - started),
      waitingMs: Math.round(headersAt - started),
      downloadMs: Math.round(doneAt - headersAt),
      bytes: raw.length,
    }
  } catch (err) {
    if (controller && controller.signal.aborted) {
      return {
        timedOut: true,
        timeoutMs,
        elapsedMs: Math.round(performance.now() - started),
      }
    }
    // A rejected fetch is a transport or CORS failure, not an HTTP status.
    return {
      transportError: String(err && err.message ? err.message : err),
      elapsedMs: Math.round(performance.now() - started),
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
