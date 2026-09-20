// The record of what has been sent: days on the left, that day's jobs on the
// right with what became of each.
//
// Cards are built once and updated in place. An earlier version rebuilt the
// list on every poll tick, which threw away loaded results and anything typed
// into a card — the only way to keep results on screen was to reload, which
// stopped the polling that was wiping them.

import { callApi } from '../api.js'
import { byId } from '../endpoints.js'
import { downloadJson } from '../download.js'
import { isFinished } from '../queue-plan.js'
import { groupByDay, summariseQueue } from '../queue-stats.js'
import { renderResults, downloadCsv } from './results.js'
import { toRows, columnsFor } from '../table.js'

const STORE = 'up2data.queues'
const PAGE = 25 // the API's ceiling, so a page is as big as it may be

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
let activeDay = null

function load() {
  try {
    queues = JSON.parse(localStorage.getItem(STORE) || '[]')
  } catch {
    queues = []
  }
}
const save = () => localStorage.setItem(STORE, JSON.stringify(queues.slice(0, 80)))

export function addQueues(ids, meta = {}) {
  for (const id of ids) {
    if (queues.some((q) => q.id === id)) continue
    queues.unshift({
      id,
      endpointId: meta.endpointId,
      name: meta.name || '',
      createdAt: new Date().toISOString(),
      // What the API said when it took the job, so the card can report what
      // was dropped before anything was charged.
      submitted: meta.submitted,
      enqueued: meta.enqueued,
      skipped: meta.skipped,
      webhooks: meta.webhooks,
      status: null,
      processed: 0,
      total: 0,
    })
  }
  save()
  activeDay = null
  render()
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
    if (isFinished(queue) && !queue.finishedAt) queue.finishedAt = new Date().toISOString()
    save()
    if (isFinished(queue)) stopPolling(queue.id)
  } else if (result.transportError || !result.ok) {
    queue.error = result.transportError || `status ${result.status}`
    stopPolling(queue.id)
  }

  const entry = cards.get(queue.id)
  if (entry) {
    updateCard(queue, entry)
    // Count what came back as soon as it is worth counting, once.
    if (isFinished(queue) && !entry.counted) {
      entry.counted = true
      countResults(queue, entry)
    }
  }
}

export function startPolling(id) {
  const queue = queues.find((q) => q.id === id)
  if (!queue || timers.has(id)) return
  timers.set(id, setInterval(() => tick(queue), 5000))
  tick(queue)
}

export function stopPolling(id) {
  const timer = timers.get(id)
  if (timer) clearInterval(timer)
  timers.delete(id)
}

function removeQueue(id) {
  stopPolling(id)
  queues = queues.filter((q) => q.id !== id)
  cards.delete(id)
  save()
  render()
}

// --- results -------------------------------------------------------------

// How many results exist, which is the only way to tell how many of the
// enqueued items produced nothing.
async function countResults(queue, entry) {
  const token = ctx.getToken()
  if (!token) return
  const result = await callApi({
    endpoint: byId('list'),
    state: { queueId: { value: queue.id }, page: { value: 0 }, limit: { value: 1 } },
    token,
  })
  if (result.ok && result.body && Number.isFinite(result.body.total)) {
    queue.returned = result.body.total
    if (Number.isFinite(result.body.totalResults)) queue.totalResults = result.body.totalResults
    save()
    updateCard(queue, entry)
  }
}

function hideResults(entry) {
  entry.open = false
  entry.refs.results.textContent = ''
  entry.refs.show.textContent = 'Show results'
}

async function showResults(queue, entry) {
  entry.open = true
  entry.refs.show.textContent = 'Hide results'
  const token = ctx.getToken()
  if (!token) return
  const target = entry.refs.results
  target.textContent = ''
  target.append(el('p', 'hint', 'Loading…'))

  const result = await callApi({
    endpoint: byId('list'),
    state: { queueId: { value: queue.id }, page: { value: 0 }, limit: { value: PAGE } },
    token,
  })

  target.textContent = ''
  if (result.transportError || !result.ok) {
    target.append(el('p', 'hint', result.transportError || `Could not load results (${result.status}).`))
    return
  }
  const items = result.body?.items || []
  if (!items.length) {
    target.append(
      el('p', 'hint', 'The queue reports no results to list. Take them from the webhook callback instead.')
    )
    return
  }
  renderResults(target, items, [queue.endpointId, queue.id])
  if ((result.body.total || 0) > items.length) {
    target.append(
      el('p', 'hint', `Showing the first ${items.length} of ${result.body.total}. Download every page for the rest.`)
    )
  }
}

// Walks from page 0 until a short page comes back, then saves one file in
// whichever shape was asked for. CSV is what a spreadsheet wants; JSON keeps
// the nesting.
async function downloadEverything(queue, btn, shape = 'json') {
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
        state: { queueId: { value: queue.id }, page: { value: page }, limit: { value: PAGE } },
        token,
      })
      if (result.transportError || !result.ok) {
        btn.textContent = result.transportError ? 'Transport error' : `Stopped at ${result.status}`
        break
      }
      const items = result.body?.items || []
      all.push(...items)
      if (items.length < PAGE) {
        if (shape === 'csv') {
          const rows = toRows(all)
          downloadCsv(rows, columnsFor(rows, 60), [queue.endpointId, queue.id, 'all'])
        } else {
          downloadJson(all, [queue.endpointId, queue.id, 'all'])
        }
        btn.textContent = `Saved ${all.length}`
        break
      }
      page += 1
    }
  } finally {
    btn.disabled = false
    setTimeout(() => (btn.textContent = label), 2500)
  }
}

// --- cards ---------------------------------------------------------------

function buildCard(queue) {
  const card = el('div', 'queue')
  const refs = {}

  const head = el('div', 'queue-head')
  head.append(el('span', 'queue-name', queue.name || '(unnamed)'))
  head.append(el('span', 'chip', queue.endpointId))
  head.append(el('span', 'mono muted', queue.id))
  card.append(head)

  const bar = el('div', 'bar')
  refs.fill = el('div', 'bar-fill')
  bar.append(refs.fill)
  card.append(bar)

  refs.stats = el('div', 'stats stats-minor')
  card.append(refs.stats)

  refs.why = el('div', 'queue-why')
  card.append(refs.why)

  const actions = el('div', 'row-actions')
  refs.show = el('button', 'btn-ghost', 'Show results')
  refs.show.addEventListener('click', () => {
    if (entry.open) return hideResults(entry)
    showResults(queue, entry)
  })

  const saveCsv = el('button', 'btn-ghost', 'Download all as CSV')
  saveCsv.addEventListener('click', () => downloadEverything(queue, saveCsv, 'csv'))

  const saveAll = el('button', 'btn-ghost', 'Download all as JSON')
  saveAll.addEventListener('click', () => downloadEverything(queue, saveAll, 'json'))

  const forget = el('button', 'btn-ghost danger', 'Forget')
  forget.addEventListener('click', () => removeQueue(queue.id))

  actions.append(refs.show, saveCsv, saveAll, forget)
  refs.results = el('div', 'queue-results')
  card.append(actions, refs.results)

  const entry = { card, refs, counted: false }
  return entry
}

function stat(label, value, tone) {
  const cell = el('div', 'stat')
  const v = el('span', 'stat-value', String(value))
  if (tone) v.classList.add(tone)
  cell.append(v, el('span', 'stat-label', label))
  return cell
}

function updateCard(queue, entry) {
  const { refs } = entry
  const s = summariseQueue(queue)

  const pct = queue.total ? Math.round((queue.processed / queue.total) * 100) : 0
  refs.fill.style.width = `${pct}%`
  refs.fill.classList.toggle('done', isFinished(queue))

  refs.stats.textContent = ''
  refs.stats.append(stat('sent', s.enqueued))
  if (s.returned !== null) {
    refs.stats.append(stat('came back', s.returned, s.returned ? 'ok' : null))
    refs.stats.append(stat('no result', s.missing, s.missing ? 'bad' : null))
  } else {
    refs.stats.append(stat('done', `${s.processed}/${queue.total || s.enqueued}`))
  }
  refs.stats.append(stat(s.finished ? 'took' : 'running for', s.duration))
  if (s.finished && s.perItemMs) refs.stats.append(stat('each', `${(s.perItemMs / 1000).toFixed(1)}s`))

  refs.why.textContent = ''
  const lines = []
  if (s.invalid) lines.push(`${s.invalid} dropped before sending — not a usable link or id.`)
  if (s.duplicates) lines.push(`${s.duplicates} dropped as duplicates, so you were not charged twice.`)
  if (s.missing) {
    lines.push(
      `${s.missing} of ${s.enqueued} produced no result. The API does not say which or why per item — the webhook callbacks carry what did arrive.`
    )
  }
  if (queue.error) lines.push(queue.error)
  if (!s.finished && !timers.has(queue.id)) lines.push('Not being watched. It keeps running on their side.')
  for (const line of lines) refs.why.append(el('p', 'hint', line))

  refs.show.disabled = !isFinished(queue) && !s.processed
  refs.show.textContent = entry.open ? 'Hide results' : 'Show results'
}

// --- the panel -----------------------------------------------------------

export function render() {
  if (!container) return
  container.textContent = ''

  if (!queues.length) {
    container.append(el('p', 'hint', 'Jobs you send appear here, grouped by the day you sent them.'))
    return
  }

  const days = groupByDay(queues)
  if (!activeDay || !days.some((d) => d.key === activeDay)) activeDay = days[0].key

  const layout = el('div', 'jobs-layout')

  const rail = el('nav', 'day-rail')
  for (const day of days) {
    const btn = el('button', 'day' + (day.key === activeDay ? ' on' : ''))
    btn.append(el('span', 'day-label', day.label))
    btn.append(el('span', 'day-count', String(day.count)))
    btn.addEventListener('click', () => {
      activeDay = day.key
      render()
    })
    rail.append(btn)
  }

  const list = el('div', 'day-jobs')
  for (const queue of days.find((d) => d.key === activeDay).queues) {
    let entry = cards.get(queue.id)
    if (!entry) {
      entry = buildCard(queue)
      cards.set(queue.id, entry)
    }
    updateCard(queue, entry)
    list.append(entry.card)
  }

  layout.append(rail, list)
  container.append(layout)
}

export function mountQueues(node, context) {
  container = node
  ctx = { ...ctx, ...context }
  load()
  render()
}
