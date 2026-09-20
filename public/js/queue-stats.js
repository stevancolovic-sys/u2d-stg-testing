// What became of a job, and when it ran.
//
// The API never reports a per-item failure: it says how many were enqueued,
// how many it processed, and later how many results exist. The gap between
// enqueued and returned is what did not come back — so that is what gets
// named, rather than inventing a reason nobody was given.

const dayKey = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? 'unknown'
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function dayLabel(key, now = new Date()) {
  if (key === 'unknown') return 'No date'
  const today = dayKey(now.toISOString())
  const yesterday = dayKey(new Date(now.getTime() - 86400000).toISOString())
  if (key === today) return 'Today'
  if (key === yesterday) return 'Yesterday'
  const [y, m, d] = key.split('-').map(Number)
  const sameYear = y === now.getFullYear()
  return `${d} ${MONTHS[m - 1]}${sameYear ? '' : ' ' + y}`
}

// Newest day first, and newest job first within a day.
export function groupByDay(queues, now = new Date()) {
  const days = new Map()
  for (const queue of queues || []) {
    const key = dayKey(queue.createdAt)
    if (!days.has(key)) days.set(key, [])
    days.get(key).push(queue)
  }

  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({
      key,
      label: dayLabel(key, now),
      count: list.length,
      queues: list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    }))
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

// `returned` is what /list reports as total, once it has been read.
export function summariseQueue(queue, now = Date.now()) {
  const q = queue || {}
  const enqueued = Number.isFinite(q.enqueued) ? q.enqueued : q.total || 0
  const returned = Number.isFinite(q.returned) ? q.returned : null

  const started = q.createdAt ? new Date(q.createdAt).getTime() : null
  const ended = q.finishedAt ? new Date(q.finishedAt).getTime() : null
  const durationMs = started ? (ended || now) - started : null

  const skipped = q.skipped || {}
  const invalid = skipped.invalid || 0
  const duplicates = skipped.duplicates || 0

  return {
    submitted: Number.isFinite(q.submitted) ? q.submitted : enqueued + invalid + duplicates,
    invalid,
    duplicates,
    enqueued,
    processed: q.processed || 0,
    returned,
    // Only knowable once the results have been counted.
    missing: returned === null ? null : Math.max(0, enqueued - returned),
    finished: Boolean(ended),
    durationMs,
    duration: formatDuration(durationMs),
    perItemMs: enqueued && durationMs ? Math.round(durationMs / enqueued) : null,
  }
}
