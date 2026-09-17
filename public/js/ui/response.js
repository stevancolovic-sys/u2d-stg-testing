// Renders one API response: status, timing, rate-limit headers, body.
// Every value arrives from the network, so it goes in via textContent.

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const RATE_HEADERS = ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'retry-after']

// The search endpoints answer a 400 with an `errors` array; everything else
// answers with a `message` string. Both need to read as one thing.
function errorLines(body) {
  if (!body) return []
  if (typeof body.message === 'string') return [body.message]
  if (Array.isArray(body.errors)) {
    return body.errors.map((e) => `${e.path || e.param || 'request'}: ${e.msg || e.message || ''}`)
  }
  if (typeof body.error === 'string') return [body.error]
  return []
}

export function renderResponse(container, result) {
  container.textContent = ''

  if (result.transportError) {
    const box = el('div', 'result bad')
    box.append(el('div', 'result-head', 'Request never reached the API'))
    box.append(el('p', 'hint', result.transportError))
    box.append(el('p', 'hint', 'Usually a network drop or a blocked request — not an API error.'))
    container.append(box)
    return
  }

  const box = el('div', `result ${result.ok ? 'ok' : 'bad'}`)

  const head = el('div', 'result-head')
  head.append(el('span', 'status', `${result.status} ${result.statusText}`))
  head.append(el('span', 'muted', `${result.elapsedMs} ms`))
  box.append(head)

  const rate = RATE_HEADERS.filter((h) => result.headers[h] !== undefined)
  if (rate.length) {
    const strip = el('div', 'rate')
    for (const h of rate) {
      const cell = el('div', 'rate-cell')
      cell.append(el('span', 'mono muted', h))
      cell.append(el('span', 'mono', result.headers[h]))
      strip.append(cell)
    }
    box.append(strip)
  }

  const errors = result.ok ? [] : errorLines(result.body)
  if (errors.length) {
    const list = el('ul', 'errors')
    for (const line of errors) list.append(el('li', null, line))
    box.append(list)
  }

  const pre = el('pre', 'json')
  pre.textContent = result.body ? JSON.stringify(result.body, null, 2) : result.raw || '(empty body)'
  box.append(pre)

  container.append(box)
}

// Pulls queue ids out of whichever shape the endpoint returned.
export function captureQueues(body) {
  if (!body) return []
  if (typeof body.queueId === 'string') return [body.queueId]
  if (Array.isArray(body.queueIds)) return body.queueIds.filter((id) => typeof id === 'string')
  return []
}

// Every enqueue echoes the webhooks its tags resolved to. Showing them is the
// fastest confirmation that routing is wired up correctly.
export function renderResolvedWebhooks(container, body) {
  container.textContent = ''
  if (!body || !Array.isArray(body.webhooks)) return
  if (!body.webhooks.length) {
    container.append(el('p', 'hint', 'No webhooks matched — results will not be delivered by callback.'))
    return
  }
  container.append(el('div', 'label', 'Callbacks routed to'))
  for (const hook of body.webhooks) {
    const row = el('div', 'hook-target')
    row.append(el('span', null, hook.name || '(unnamed)'))
    row.append(el('span', 'mono muted', hook.url || ''))
    container.append(row)
  }
}
