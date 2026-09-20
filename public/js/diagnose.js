// Working out what a failed fetch actually means.
//
// A browser hides the status of a response that carries no CORS headers, and
// an nginx error page carries none — so a request the server timed out on
// arrives in JavaScript as "Failed to fetch", indistinguishable from being
// offline. The difference matters: one is the API's problem, the other is
// yours. Asking the same API something cheap afterwards tells them apart.

// Long enough that a gateway was plainly waiting on something, rather than
// the request being refused outright. nginx's default is 60s.
export const SERVER_TIMEOUT_MS = 20000

export function classifyTransportFailure({ elapsedMs = 0, probeOk = null } = {}) {
  const slow = elapsedMs >= SERVER_TIMEOUT_MS

  if (probeOk === true) {
    return {
      reachable: true,
      headline: slow
        ? 'The API is up — this request timed out on the server'
        : 'The API is up — this request failed on the server',
      detail:
        (slow
          ? `Nothing came back for ${Math.round(elapsedMs / 1000)} seconds, then the connection failed. `
          : 'Another call to the same API answered straight away. ') +
        'A gateway error page carries no CORS headers, so the browser cannot show you the status and reports a failed fetch instead. ' +
        'This is a server-side failure, not a network or CORS problem.',
    }
  }

  if (probeOk === false) {
    return {
      reachable: false,
      headline: 'The API is not answering at all',
      detail:
        'A second, cheap call to the same API also failed, so this is not about one request. ' +
        'Check the API base URL at the top, your connection, and whether the service is up.',
    }
  }

  return {
    reachable: null,
    headline: 'Request never reached the API',
    detail:
      'The browser could not complete the request and cannot see why. ' +
      'Common causes are a dropped connection, a blocked request, or a server error page that carries no CORS headers.',
  }
}
