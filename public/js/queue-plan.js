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

// A finished queue should show its results without being asked, but only
// once — re-fetching on every tick would spend nothing but would blow away
// the page the user had paged to.
export function shouldAutoLoadResults(queue, loadedAlready) {
  return queue.status === 'completed' && !loadedAlready
}
