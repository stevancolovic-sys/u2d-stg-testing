// A thin wrapper so the UI never reaches into an endpoint's internals.
// Returns null for endpoints that cost nothing.
export function estimateCredits(endpoint, state) {
  if (!endpoint || !endpoint.credits) return null
  return endpoint.credits(state)
}
