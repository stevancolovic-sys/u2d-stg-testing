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

export function summarise(results, perRequestCost) {
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

  return {
    sent: done.length,
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
