// Renders one API response: status, timing, rate-limit headers, body.
// Every value arrives from the network, so it goes in via textContent.

import { downloadJson, copyJson } from '../download.js'
import { renderJsonTree } from './json-view.js'
import { classifyTransportFailure } from '../diagnose.js'

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

// Saving and copying what came back. `name` becomes part of the filename, so
// a folder of downloads still says which endpoint each one came from.
function saveRow(payload, name) {
  const row = el('div', 'row-actions')

  const save = el('button', 'btn-ghost', 'Download JSON')
  save.addEventListener('click', () => downloadJson(payload, name))

  const copy = el('button', 'btn-ghost', 'Copy JSON')
  copy.addEventListener('click', async () => {
    try {
      await copyJson(payload)
      copy.textContent = 'Copied'
    } catch {
      copy.textContent = 'Copy blocked'
    }
    setTimeout(() => (copy.textContent = 'Copy JSON'), 1200)
  })

  row.append(save, copy)
  return row
}

// A response body, as a tree you can fold away. The raw text stays one click
// behind it: a browser's own find only searches what is on the page, and a
// folded node is not, so anyone hunting for a value needs the flat view too.
function renderBody(result) {
  const wrap = el('div', 'json-body')

  if (result.body === null || result.body === undefined) {
    const pre = el('pre', 'json')
    pre.textContent = result.raw || '(empty body)'
    wrap.append(pre)
    return wrap
  }

  const tree = renderJsonTree(result.body)
  const pre = el('pre', 'json')
  pre.textContent = JSON.stringify(result.body, null, 2)
  pre.hidden = true

  const tools = el('div', 'json-tools')
  const expand = el('button', 'btn-ghost', 'Expand all')
  const collapse = el('button', 'btn-ghost', 'Collapse all')
  const raw = el('button', 'btn-ghost', 'Raw')

  expand.addEventListener('click', () => tree.openAll())
  collapse.addEventListener('click', () => tree.closeAll())
  raw.addEventListener('click', () => {
    const showingRaw = !pre.hidden
    pre.hidden = showingRaw
    tree.hidden = !showingRaw
    raw.textContent = showingRaw ? 'Raw' : 'Tree'
    expand.disabled = !showingRaw
    collapse.disabled = !showingRaw
  })

  tools.append(expand, collapse, raw)
  wrap.append(tools, tree, pre)
  return wrap
}

export function renderResponse(container, result, name) {
  container.textContent = ''

  if (result.transportError) {
    const verdict = classifyTransportFailure({
      elapsedMs: result.elapsedMs,
      probeOk: result.probeOk,
    })
    const box = el('div', 'result bad')
    box.append(el('div', 'result-head', verdict.headline))
    box.append(el('p', 'hint', verdict.detail))
    box.append(el('p', 'hint mono', result.transportError))
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

  box.append(renderBody(result))

  // A failed response is worth saving too — that is usually the one you want
  // to hand to someone.
  if (result.body !== null || result.raw) {
    box.append(saveRow(result.body !== null ? result.body : result.raw, name || 'response'))
  }

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
