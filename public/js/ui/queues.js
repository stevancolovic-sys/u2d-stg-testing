// Tracks the queues this tool created: status polling and result paging.
//
// Cards are built once and updated in place. An earlier version rebuilt the
// whole list on every poll tick, which silently threw away loaded results,
// their download buttons, and any page number typed into the card — the only
// way to keep results on screen was to reload the page, which stopped the
// polling that was wiping them.
//
// Polling starts by itself for a queue just created, and stops at
// `completed`. Queues restored from a previous session wait for a click, so
// reopening the tool never starts a dozen polling loops.

import { callApi } from '../api.js'
import { byId } from '../endpoints.js'
import { downloadJson, copyJson } from '../download.js'
import { planCards, shouldAutoLoadResults } from '../queue-plan.js'

const STORE = 'up2data.queues'
const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const timers = new Map()
const cards = new Map()
let queues = []
let container = null
let ctx = { getToken: () => null }

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
  // A queue created right now starts polling immediately. One restored from a
  // previous session does not — see mountQueues.
  for (const id of ids) startPolling(id)
}

// --- polling -------------------------------------------------------------

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

  const entry = cards.get(queue.id)
  if (entry) {
    updateCard(queue, entry)
    // Show the results the moment the queue finishes, without another click.
    if (shouldAutoLoadResults(queue, entry.resultsLoaded)) {
      entry.resultsLoaded = true
      entry.refs.load.click()
    }
  }
}

export function startPolling(id) {
  const queue = queues.find((q) => q.id === id)
  if (!queue || timers.has(id)) return
  timers.set(id, setInterval(() => tick(queue), 5000))
  refreshToggle(id)
  tick(queue)
}

export function stopPolling(id) {
  const timer = timers.get(id)
  if (timer) clearInterval(timer)
  timers.delete(id)
  refreshToggle(id)
}

function refreshToggle(id) {
  const entry = cards.get(id)
  if (entry) entry.refs.toggle.textContent = timers.has(id) ? 'Stop checking' : 'Check status'
}

function removeQueue(id) {
  stopPolling(id)
  queues = queues.filter((q) => q.id !== id)
  save()
  render()
}

// --- results -------------------------------------------------------------

async function loadResults(queue, refs) {
  const token = ctx.getToken()
  if (!token) return

  // The API rejects anything outside 1–25, so clamp before asking.
  const limit = Math.min(25, Math.max(1, Number(refs.limit.value) || 10))
  const page = Math.max(0, Number(refs.page.value) || 0)
  refs.limit.value = String(limit)
  refs.page.value = String(page)

  const target = refs.results
  target.textContent = 'Loading…'

  const result = await callApi({
    endpoint: byId('list'),
    state: {
      queueId: { value: queue.id },
      page: { value: page },
      limit: { value: limit },
      failed: { enabled: refs.failed.checked, value: true },
    },
    token,
  })

  target.textContent = ''
  if (result.transportError) {
    target.append(el('p', 'hint', result.transportError))
    return
  }
  if (!result.ok) {
    target.append(el('p', 'hint', `${result.status} — ${(result.raw || '').slice(0, 300)}`))
    return
  }

  const body = result.body || {}
  const items = body.items ?? body

  const summary = el('div', 'result-head')
  summary.append(el('span', 'muted', `${(body.items || []).length} shown · total ${body.total ?? '?'}`))
  if (body.totalResults !== undefined) {
    summary.append(
      el('span', 'muted', `search reported ${body.totalResults} — more than the queue scrapes`)
    )
  }
  target.append(summary)

  const pre = el('pre', 'json')
  pre.textContent = JSON.stringify(items, null, 2)
  target.append(pre)

  const actions = el('div', 'row-actions')

  const savePage = el('button', 'btn-ghost', 'Download page')
  savePage.addEventListener('click', () =>
    downloadJson(items, [queue.endpointId, queue.id, `page-${page}`])
  )

  const copy = el('button', 'btn-ghost', 'Copy JSON')
  copy.addEventListener('click', async () => {
    try {
      await copyJson(items)
      copy.textContent = 'Copied'
    } catch {
      copy.textContent = 'Copy blocked'
    }
    setTimeout(() => (copy.textContent = 'Copy JSON'), 1200)
  })

  const saveAll = el('button', 'btn-ghost', 'Download every page')
  saveAll.addEventListener('click', () =>
    downloadEveryPage(queue, limit, refs.failed.checked, saveAll)
  )

  actions.append(savePage, copy, saveAll)
  target.append(actions)
}

// Walks the queue from page 0 until a page comes back short, then saves the
// lot as one file. The API caps limit at 25, so a large queue is many calls —
// the button reports progress rather than looking stuck.
async function downloadEveryPage(queue, limit, failed, btn) {
  const token = ctx.getToken()
  if (!token) return

  const label = btn.textContent
  btn.disabled = true

  const all = []
  let page = 0

  try {
    for (;;) {
      btn.textContent = `Fetching page ${page + 1}…`
      const result = await callApi({
        endpoint: byId('list'),
        state: {
          queueId: { value: queue.id },
          page: { value: page },
          limit: { value: limit },
          failed: { enabled: failed, value: true },
        },
        token,
      })

      if (result.transportError || !result.ok) {
        btn.textContent = result.transportError ? 'Transport error' : `Stopped at ${result.status}`
        break
      }

      const items = result.body?.items || []
      all.push(...items)
      if (items.length < limit) {
        downloadJson(all, [queue.endpointId, queue.id, 'all'])
        btn.textContent = `Saved ${all.length}`
        break
      }
      page += 1
    }
  } finally {
    btn.disabled = false
    setTimeout(() => (btn.textContent = label), 2000)
  }
}

// --- cards ---------------------------------------------------------------

function buildCard(queue) {
  const card = el('div', 'queue')
  const refs = {}

  const head = el('div', 'queue-head')
  head.append(el('span', 'mono', queue.id))
  head.append(el('span', 'muted', queue.endpointId))
  card.append(head)

  if (queue.name) card.append(el('div', 'muted', queue.name))

  const bar = el('div', 'bar')
  refs.fill = el('div', 'bar-fill')
  bar.append(refs.fill)
  card.append(bar)

  refs.meta = el('div', 'queue-meta')
  card.append(refs.meta)

  const actions = el('div', 'row-actions')

  refs.toggle = el('button', 'btn-ghost')
  refs.toggle.addEventListener('click', () =>
    timers.has(queue.id) ? stopPolling(queue.id) : startPolling(queue.id)
  )
  actions.append(refs.toggle)

  refs.page = el('input', 'input input-num')
  refs.page.type = 'number'
  refs.page.min = '0'
  refs.page.value = '0'
  refs.page.title = 'page (0-indexed)'

  refs.limit = el('input', 'input input-num')
  refs.limit.type = 'number'
  refs.limit.min = '1'
  refs.limit.max = '25'
  refs.limit.value = '10'
  refs.limit.title = 'limit (1–25)'

  refs.failed = el('input')
  refs.failed.type = 'checkbox'
  const failedLabel = el('label', 'toggle')
  failedLabel.append(refs.failed, el('span', 'mono', 'failed'))

  refs.results = el('div', 'queue-results')

  refs.load = el('button', 'btn-ghost', 'Load results')
  refs.load.addEventListener('click', () => {
    entry.resultsLoaded = true
    loadResults(queue, refs)
  })

  actions.append(refs.page, refs.limit, failedLabel, refs.load)

  const remove = el('button', 'btn-ghost danger', 'Forget')
  remove.addEventListener('click', () => removeQueue(queue.id))
  actions.append(remove)

  card.append(actions, refs.results)

  const entry = { card, refs, resultsLoaded: false }
  return entry
}

function updateCard(queue, entry) {
  const { refs } = entry
  const pct = queue.total ? Math.round((queue.processed / queue.total) * 100) : 0
  refs.fill.style.width = `${pct}%`
  refs.fill.classList.toggle('done', queue.status === 'completed')

  refs.meta.textContent = ''
  refs.meta.append(
    el(
      'span',
      null,
      queue.status ? `${queue.status} · ${queue.processed}/${queue.total}` : 'not checked yet'
    )
  )
  if (queue.error) refs.meta.append(el('span', 'muted', queue.error))

  refs.toggle.textContent = timers.has(queue.id) ? 'Stop checking' : 'Check status'
}

export function render() {
  if (!container) return

  const plan = planCards([...cards.keys()], queues)

  for (const id of plan.remove) {
    const entry = cards.get(id)
    if (entry) entry.card.remove()
    cards.delete(id)
  }

  for (const id of plan.create) {
    const queue = queues.find((q) => q.id === id)
    cards.set(id, buildCard(queue))
  }

  // Existing cards keep their DOM — and therefore their loaded results.
  for (const id of plan.update) {
    const queue = queues.find((q) => q.id === id)
    updateCard(queue, cards.get(id))
  }

  const empty = container.querySelector('.queues-empty')
  if (!queues.length) {
    if (!empty) {
      container.append(
        el('p', 'hint queues-empty', 'Queues you create appear here, with their progress and results.')
      )
    }
    return
  }
  if (empty) empty.remove()

  // Re-append in order. Moving a node that is already attached does not
  // recreate it, so nothing inside a card is lost.
  for (const id of plan.order) container.append(cards.get(id).card)
}

export function mountQueues(node, context) {
  container = node
  ctx = { ...ctx, ...context }
  load()
  render()
}
