// Tracks the queues this tool created: status polling and result paging.
//
// Polling starts by itself for a queue just created, and stops at
// `completed`. Queues restored from a previous session wait for a click —
// reopening the tool should not silently start a dozen polling loops.

import { callApi } from '../api.js'
import { byId } from '../endpoints.js'

const STORE = 'up2data.queues'
const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const timers = new Map()
let queues = []
let ctx = { getToken: () => null, onRender: () => {} }

function load() {
  try {
    queues = JSON.parse(localStorage.getItem(STORE) || '[]')
  } catch {
    queues = []
  }
}
const save = () => localStorage.setItem(STORE, JSON.stringify(queues.slice(0, 40)))

export function addQueues(ids, meta) {
  for (const id of ids) {
    if (queues.some((q) => q.id === id)) continue
    queues.unshift({
      id,
      endpointId: meta.endpointId,
      name: meta.name || '',
      createdAt: new Date().toISOString(),
      status: null,
      processed: 0,
      total: 0,
    })
  }
  save()
  render()
  // A queue created right now starts polling immediately. One restored from
  // a previous session does not — see mountQueues.
  for (const id of ids) startPolling(id)
}

async function tick(queue) {
  const token = ctx.getToken()
  if (!token) return stopPolling(queue.id)

  const result = await callApi({
    endpoint: byId('status'),
    state: { queueId: { value: queue.id } },
    token,
  })

  if (result.body && typeof result.body.status === 'string') {
    queue.status = result.body.status
    queue.processed = result.body.processed ?? 0
    queue.total = result.body.total ?? 0
    save()
    if (queue.status === 'completed') stopPolling(queue.id)
  } else if (result.transportError || !result.ok) {
    queue.error = result.transportError || `status ${result.status}`
    stopPolling(queue.id)
  }
  render()
}

export function startPolling(id) {
  const queue = queues.find((q) => q.id === id)
  if (!queue || timers.has(id)) return
  tick(queue)
  timers.set(id, setInterval(() => tick(queue), 5000))
  render()
}

export function stopPolling(id) {
  const timer = timers.get(id)
  if (timer) clearInterval(timer)
  timers.delete(id)
  render()
}

function removeQueue(id) {
  stopPolling(id)
  queues = queues.filter((q) => q.id !== id)
  save()
  render()
}

async function loadResults(queue, page, limit, failed, target) {
  const token = ctx.getToken()
  if (!token) return
  target.textContent = 'Loading…'

  const state = {
    queueId: { value: queue.id },
    page: { value: page },
    limit: { value: limit },
    failed: { enabled: failed, value: true },
  }
  const result = await callApi({ endpoint: byId('list'), state, token })

  target.textContent = ''
  if (result.transportError) {
    target.append(el('p', 'hint', result.transportError))
    return
  }
  if (!result.ok) {
    target.append(el('p', 'hint', `${result.status} — ${result.raw.slice(0, 300)}`))
    return
  }

  const body = result.body || {}
  const summary = el('div', 'result-head')
  summary.append(el('span', 'muted', `${(body.items || []).length} shown · total ${body.total ?? '?'}`))
  if (body.totalResults !== undefined) {
    summary.append(
      el('span', 'muted', `search reported ${body.totalResults} — more than the queue scrapes`)
    )
  }
  target.append(summary)

  const pre = el('pre', 'json')
  pre.textContent = JSON.stringify(body.items ?? body, null, 2)
  target.append(pre)
}

function renderQueue(queue) {
  const card = el('div', 'queue')

  const head = el('div', 'queue-head')
  head.append(el('span', 'mono', queue.id))
  head.append(el('span', 'muted', queue.endpointId))
  card.append(head)

  if (queue.name) card.append(el('div', 'muted', queue.name))

  const pct = queue.total ? Math.round((queue.processed / queue.total) * 100) : 0
  const bar = el('div', 'bar')
  const fill = el('div', 'bar-fill')
  fill.style.width = `${pct}%`
  if (queue.status === 'completed') fill.classList.add('done')
  bar.append(fill)
  card.append(bar)

  const meta = el('div', 'queue-meta')
  meta.append(el('span', null, queue.status ? `${queue.status} · ${queue.processed}/${queue.total}` : 'not checked yet'))
  if (queue.error) meta.append(el('span', 'muted', queue.error))
  card.append(meta)

  const actions = el('div', 'row-actions')
  const polling = timers.has(queue.id)
  const toggle = el('button', 'btn-ghost', polling ? 'Stop checking' : 'Check status')
  toggle.addEventListener('click', () => (polling ? stopPolling(queue.id) : startPolling(queue.id)))
  actions.append(toggle)

  const pageInput = el('input', 'input input-num')
  pageInput.type = 'number'
  pageInput.min = '0'
  pageInput.value = '0'
  pageInput.title = 'page (0-indexed)'
  const limitInput = el('input', 'input input-num')
  limitInput.type = 'number'
  limitInput.min = '1'
  limitInput.max = '25'
  limitInput.value = '10'
  limitInput.title = 'limit (1–25)'
  const failedBox = el('input')
  failedBox.type = 'checkbox'
  const failedLabel = el('label', 'toggle')
  failedLabel.append(failedBox, el('span', 'mono', 'failed'))

  const results = el('div', 'queue-results')
  const loadBtn = el('button', 'btn-ghost', 'Load results')
  loadBtn.addEventListener('click', () => {
    // The API rejects anything outside 1–25, so clamp before asking.
    const limit = Math.min(25, Math.max(1, Number(limitInput.value) || 10))
    limitInput.value = String(limit)
    const page = Math.max(0, Number(pageInput.value) || 0)
    pageInput.value = String(page)
    loadResults(queue, page, limit, failedBox.checked, results)
  })

  actions.append(pageInput, limitInput, failedLabel, loadBtn)

  const remove = el('button', 'btn-ghost danger', 'Forget')
  remove.addEventListener('click', () => removeQueue(queue.id))
  actions.append(remove)

  card.append(actions, results)
  return card
}

let container = null

export function render() {
  if (!container) return
  container.textContent = ''
  if (!queues.length) {
    container.append(el('p', 'hint', 'Queues you create appear here, with their progress and results.'))
    return
  }
  for (const queue of queues) container.append(renderQueue(queue))
}

export function mountQueues(node, context) {
  container = node
  ctx = { ...ctx, ...context }
  load()
  render()
}
