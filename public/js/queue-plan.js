// Deciding what the queue list should do on a poll tick.
//
// Kept separate from the DOM because the bug this exists to prevent was a DOM
// one: rebuilding every card on every tick threw away loaded results, the
// buttons attached to them, and whatever page number had been typed. Cards
// are built once and updated in place, and this decides which is which.

export function planCards(existingIds, queues) {
  const present = new Set(existingIds)
  const wanted = queues.map((q) => q.id)
  const wantedSet = new Set(wanted)

  return {
    create: wanted.filter((id) => !present.has(id)),
    update: wanted.filter((id) => present.has(id)),
    remove: existingIds.filter((id) => !wantedSet.has(id)),
    order: wanted,
  }
}

// The documentation says status is "pending" or "completed". Staging also
// answers "notified", which is what a finished queue looks like once its
// webhooks have gone out — so a queue was left polling forever and never
// showed its results. The count is the reliable signal: the vocabulary is
// not ours to predict, but processed reaching total is arithmetic.
const KNOWN_TERMINAL = ['completed', 'notified', 'finished', 'done', 'failed', 'error']

export function isFinished(queue) {
  if (!queue) return false
  if (queue.total > 0 && queue.processed >= queue.total) return true
  return KNOWN_TERMINAL.includes(String(queue.status || '').toLowerCase())
}

// A finished queue should show its results without being asked, but only
// once — re-fetching on every tick would blow away the page it had paged to.
export function shouldAutoLoadResults(queue, loadedAlready) {
  return isFinished(queue) && !loadedAlready
}
