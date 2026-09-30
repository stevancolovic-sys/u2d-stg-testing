// Running many v1 calls at once, without spending more than you meant to.
//
// v1 reports what each call cost in its own reply — meta.creditsUsed and
// meta.creditsRemaining — so nothing here estimates. The run watches what was
// actually spent and stops at the budget it was given.

import { V1_ENDPOINTS } from './v1-endpoints.js'
import { percentile } from './burst.js'

// Search is rate limited by the hour rather than the minute, so a volume run
// exhausts it in seconds and everything after is a 429.
export const isSearch = (endpoint) => String(endpoint?.path || '').includes('/search/')

export const searchOpsAmong = (ids) =>
  V1_ENDPOINTS.filter((e) => ids.includes(e.id) && isSearch(e)).map((e) => e.id)

// What one call cost, straight from the reply. A call that did not bill says
// so, and a reply without meta tells us nothing rather than zero.
export function creditsOf(result) {
  const meta = result?.body?.meta
  if (!meta) return null
  if (meta.billed === false) return 0
  return Number.isFinite(meta.creditsUsed) ? meta.creditsUsed : null
}

export const remainingAfter = (result) => {
  const value = result?.body?.meta?.creditsRemaining
  return Number.isFinite(value) ? value : null
}

// Why the API says it billed or did not — profile_found, unprocessable_target,
// rate_limited. Its word, not ours.
export function reasonOf(result) {
  if (result?.transportError) return 'never reached the API'
  const meta = result?.body?.meta
  if (meta?.reason) return String(meta.reason)
  const error = result?.body?.error
  if (error?.type) return String(error.type)
  return result?.status ? `status ${result.status}` : 'unknown'
}

// Stop before the next call rather than after it: the budget is what you are
// willing to spend, not what you are willing to have spent.
export function budgetReached(spent, budget) {
  if (!Number.isFinite(budget) || budget <= 0) return false
  return spent >= budget
}

export function summariseV1Run(results, budget) {
  const done = results.filter((r) => r.finishedAt !== undefined)

  const byOperation = new Map()
  let spent = 0
  let unknownCost = 0

  for (const r of done) {
    const cost = creditsOf(r.result)
    if (cost === null) unknownCost += 1
    else spent += cost

    const entry = byOperation.get(r.operationId) || {
      operationId: r.operationId,
      sent: 0,
      succeeded: 0,
      failed: 0,
      credits: 0,
      durations: [],
      reasons: new Map(),
    }
    entry.sent += 1
    if (r.result?.ok) entry.succeeded += 1
    else entry.failed += 1
    entry.credits += cost || 0
    entry.durations.push(r.finishedAt - r.startedAt)
    const reason = reasonOf(r.result)
    entry.reasons.set(reason, (entry.reasons.get(reason) || 0) + 1)
    byOperation.set(r.operationId, entry)
  }

  const operations = [...byOperation.values()]
    .map((e) => ({
      operationId: e.operationId,
      sent: e.sent,
      succeeded: e.succeeded,
      failed: e.failed,
      credits: e.credits,
      avgMs: e.durations.length
        ? Math.round(e.durations.reduce((a, b) => a + b, 0) / e.durations.length)
        : 0,
      p95: percentile(e.durations, 95),
      reasons: [...e.reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.credits - a.credits)

  const last = [...done].reverse().find((r) => remainingAfter(r.result) !== null)

  const first = done.length ? Math.min(...done.map((r) => r.startedAt)) : 0
  const lastEnd = done.length ? Math.max(...done.map((r) => r.finishedAt)) : 0

  return {
    sent: done.length,
    succeeded: done.filter((r) => r.result?.ok).length,
    failed: done.filter((r) => !r.result?.ok).length,
    credits: spent,
    unknownCost,
    creditsRemaining: last ? remainingAfter(last.result) : null,
    budget: Number.isFinite(budget) && budget > 0 ? budget : null,
    stoppedOnBudget: budgetReached(spent, budget),
    elapsedMs: Math.max(0, lastEnd - first),
    operations,
  }
}

// --- how fast it is going, and how long that can last -------------------

// Measured over a trailing window rather than the whole run, so the figure
// follows what is happening now instead of averaging away a slow start.
export function ratesOver(results, nowMs, windowMs = 60000) {
  const from = nowMs - windowMs
  const recent = results.filter((r) => r.finishedAt !== undefined && r.finishedAt >= from)
  if (!recent.length) return { perMinute: 0, creditsPerMinute: 0, window: windowMs, sampled: 0 }

  // Early in a run the window is not yet full; scaling by the whole window
  // would report a rate far below the truth.
  const span = Math.max(1, Math.min(windowMs, nowMs - Math.min(...recent.map((r) => r.startedAt))))
  const scale = 60000 / span

  let credits = 0
  for (const r of recent) {
    const cost = creditsOf(r.result)
    if (cost !== null) credits += cost
  }

  return {
    perMinute: Math.round(recent.length * scale),
    creditsPerMinute: Math.round(credits * scale),
    window: windowMs,
    sampled: recent.length,
  }
}

// The number that stands in for a limit when a run has none.
export function lastsFor(creditsRemaining, creditsPerMinute) {
  if (!Number.isFinite(creditsRemaining) || creditsRemaining <= 0) return null
  if (!Number.isFinite(creditsPerMinute) || creditsPerMinute <= 0) return null
  const minutes = creditsRemaining / creditsPerMinute
  if (minutes < 60) return `${Math.round(minutes)} min`
  if (minutes < 60 * 48) return `${(minutes / 60).toFixed(1)} h`
  return `${Math.round(minutes / 1440)} days`
}

// One entry per call, in the order they will be issued: every picked
// operation gets its share before any of them gets a second turn, so a run cut
// short by the budget still covers the spread rather than only the first one.
export function planRun(ids, perOperation) {
  const n = Math.max(0, Math.floor(perOperation) || 0)
  const plan = []
  for (let round = 0; round < n; round++) {
    for (const id of ids) plan.push({ operationId: id, round })
  }
  return plan
}
