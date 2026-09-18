// Firing many live requests at once, to watch what the rate limiter does.
//
// The live endpoints share 10 requests per 10 seconds per team. A 429 costs
// nothing, so pushing past the limit is cheap — what it buys you is the shape
// of the limiter: how many get through, when the window reopens, and whether
// Retry-After tells the truth.

// Cycles the list, so five profiles can answer twenty requests. Different
// slugs matter: repeating one can measure a cache rather than the work.
export function pickProfile(list, index) {
  if (!list.length) return null
  return list[index % list.length]
}

// Offsets in milliseconds from the start of the run. A rate of 0, Infinity or
// nothing at all means every request leaves at once.
export function scheduleDelays(count, ratePerSecond) {
  const n = Math.max(0, Math.floor(count) || 0)
  const rate = Number(ratePerSecond)
  const spread = Number.isFinite(rate) && rate > 0

  const delays = []
  for (let i = 0; i < n; i++) delays.push(spread ? Math.floor((i / rate) * 1000) : 0)
  return delays
}

export function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

// A request is billed when the API answered about a record — found or not.
// Everything else (429, 403, 400, 503, a transport failure) is free.
export const BILLED_STATUSES = [200, 404]

// Why a request did not succeed, in the API's own terms. A bare status code
// makes you go and look it up; the run should just say it.
export const REASONS = {
  200: 'enriched',
  404: 'no such record on LinkedIn — still billed',
  429: 'rate limited by the team\u2019s shared window',
  403: 'not enough credits on the team',
  400: 'not a LinkedIn URL or slug of the right kind, or the spending cap is reached',
  401: 'token missing, invalid or expired',
  503: 'no worker free within 10s, or the crawl could not finish — retry later',
}

export const reasonFor = (result) => {
  if (result.transportError) return 'never reached the API — network or CORS'
  return REASONS[result.status] || `unexpected status ${result.status}`
}

export function summarise(results, perRequestCost, requested) {
  const done = results.filter((r) => r.finishedAt !== undefined)

  const byStatus = {}
  for (const r of done) {
    const key = r.transportError ? 'transport error' : String(r.status)
    byStatus[key] = (byStatus[key] || 0) + 1
  }

  const billed = done.filter((r) => BILLED_STATUSES.includes(r.status)).length
  const durations = done.map((r) => r.finishedAt - r.startedAt)

  const first = done.length ? Math.min(...done.map((r) => r.startedAt)) : 0
  const last = done.length ? Math.max(...done.map((r) => r.finishedAt)) : 0
  const elapsedMs = Math.max(0, last - first)

  const limited = done.filter((r) => r.status === 429).sort((a, b) => a.startedAt - b.startedAt)

  // Worth stating plainly. The API advertises RateLimit-* through
  // access-control-expose-headers, but a run where none arrived means the
  // limiter told you nothing — not that you stayed under it.
  const sawRateLimitHeaders = done.some(
    (r) => r.headers && ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'retry-after'].some((h) => r.headers[h] !== undefined)
  )
  const retryAfter = limited
    .map((r) => Number(r.headers && r.headers['retry-after']))
    .filter((n) => Number.isFinite(n))

  const succeeded = done.filter((r) => r.status === 200).length
  const notSucceeded = done.filter((r) => r.status !== 200)

  // One line per reason, biggest group first.
  const grouped = new Map()
  for (const r of notSucceeded) {
    const reason = reasonFor(r)
    const key = r.transportError ? 'transport' : String(r.status)
    const entry = grouped.get(key) || { status: r.transportError ? null : r.status, reason, count: 0 }
    entry.count += 1
    grouped.set(key, entry)
  }
  const failures = [...grouped.values()].sort((a, b) => b.count - a.count)

  const avgMs = durations.length
    ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
    : 0

  return {
    requested: requested ?? done.length,
    sent: done.length,
    succeeded,
    failed: notSucceeded.length,
    failures,
    avgMs,
    byStatus,
    billed,
    credits: billed * perRequestCost,
    elapsedMs,
    // Completed requests per second across the whole run.
    throughput: elapsedMs > 0 ? Number((done.length / (elapsedMs / 1000)).toFixed(2)) : done.length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    rateLimited: limited.length,
    sawRateLimitHeaders,
    firstRateLimitAfterMs: limited.length ? limited[0].startedAt - first : null,
    retryAfterSeconds: retryAfter.length ? Math.max(...retryAfter) : null,
  }
}
