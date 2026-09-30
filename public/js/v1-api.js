// Calling v1, through the Worker.
//
// v1 authenticates with a static X-API-Key header. Sending that from the page
// would mean the key living in the browser, which is exactly what the key
// store was built to avoid — so the call goes to the Worker, which holds the
// key and forwards it.

import { buildV1Url, buildV1Body } from './v1-request.js'
import { V1_BASES } from './v1-endpoints.js'

// What the request will look like when it leaves the Worker, for the preview.
export function describeV1(endpoint, state, environment) {
  const url = buildV1Url(V1_BASES[environment] || V1_BASES.staging, endpoint, state)
  const body = buildV1Body(endpoint, state)
  const lines = [`${endpoint.method} ${url}`, 'X-API-Key: (added by the tool, never sent to the browser)']
  lines.push('')
  lines.push(body ? JSON.stringify(body, null, 2) : '(no body)')
  return lines.join('\n')
}

export function v1Curl(endpoint, state, environment) {
  const url = buildV1Url(V1_BASES[environment] || V1_BASES.staging, endpoint, state)
  const body = buildV1Body(endpoint, state)
  const lines = [`curl -X ${endpoint.method} '${url}'`, `  -H 'X-API-Key: YOUR_API_KEY'`]
  if (body) {
    lines.push(`  -H 'Content-Type: application/json'`)
    lines.push(`  -d '${JSON.stringify(body, null, 2)}'`)
  }
  return lines.join(' \\\n')
}

export async function callV1({ endpoint, state, environment = 'staging', timeoutMs = 0 }) {
  const path = buildV1Url('', endpoint, state)
  const body = buildV1Body(endpoint, state)
  const started = performance.now()

  // Giving up stops us listening; the API carries on and still bills.
  const controller = timeoutMs > 0 ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null

  let res
  try {
    res = await fetch('/keys/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment, path, method: endpoint.method, body }),
      signal: controller ? controller.signal : undefined,
    })
  } catch (err) {
    if (controller && controller.signal.aborted) {
      return { timedOut: true, timeoutMs, elapsedMs: Math.round(performance.now() - started) }
    }
    return { transportError: String(err.message || err), elapsedMs: Math.round(performance.now() - started) }
  } finally {
    if (timer) clearTimeout(timer)
  }

  const relayed = await res.json().catch(() => null)

  // The Worker itself refused — no key, or a path it would not forward.
  if (!res.ok && relayed && relayed.error) {
    return {
      ok: false,
      status: res.status,
      statusText: relayed.error,
      headers: {},
      body: relayed,
      raw: JSON.stringify(relayed),
      elapsedMs: Math.round(performance.now() - started),
      workerError: relayed.error,
    }
  }

  if (!relayed) {
    return { transportError: 'The tool could not read the reply', elapsedMs: Math.round(performance.now() - started) }
  }

  let parsed = null
  try {
    parsed = JSON.parse(relayed.raw)
  } catch {
    parsed = null
  }

  return {
    ok: relayed.ok,
    status: relayed.status,
    statusText: '',
    headers: relayed.headers || {},
    body: parsed,
    raw: relayed.raw,
    // The API's own time, measured at the Worker, plus the hop to get there.
    elapsedMs: Math.round(performance.now() - started),
    apiMs: relayed.elapsedMs,
  }
}
