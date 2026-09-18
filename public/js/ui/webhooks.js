// Receives callbacks. The Worker stores whatever arrives at /hook/<id>;
// this panel polls /hook/<id>/events and lists it.

import { downloadJson } from '../download.js'

const KEY = 'up2data.hookId'

// A webhook pointed at the bare origin lands here. It is the obvious thing to
// configure in a dashboard, so it is the default the panel watches.
export const SHARED = 'default'
const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function hookId() {
  try {
    return localStorage.getItem(KEY) || SHARED
  } catch {
    return SHARED
  }
}

export function setHookId(id) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* a browser refusing storage still gets a working session */
  }
  return id
}

export const privateId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20)

// The shared bucket answers at the origin itself; a private one needs its path.
export function hookUrl(id = hookId()) {
  return id === SHARED ? `${location.origin}/` : `${location.origin}/hook/${id}`
}

let timer = null
let container = null
let seen = 0
let latest = []

function renderEvent(event) {
  const items = Array.isArray(event.body) ? event.body : [event.body]
  const card = el('div', 'callback')

  const head = el('div', 'queue-head')
  head.append(el('span', null, new Date(event.receivedAt).toLocaleTimeString()))
  head.append(el('span', 'muted', `${items.length} item${items.length === 1 ? '' : 's'}`))
  card.append(head)

  if (event.body === null) {
    card.append(el('p', 'hint', 'Body was not JSON — shown as received.'))
    const pre = el('pre', 'json')
    pre.textContent = event.raw
    card.append(pre)
    return card
  }

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const line = el('div', 'callback-line')
    line.append(el('span', 'type', item.type || 'unknown'))
    if (item.name) line.append(el('span', null, item.name))
    if (item.url) line.append(el('span', 'mono muted', item.url))
    if (item.queueId) line.append(el('span', 'mono muted', item.queueId))
    card.append(line)
  }

  const details = el('details', 'raw')
  details.append(el('summary', null, 'Full payload'))
  const pre = el('pre', 'json')
  pre.textContent = JSON.stringify(event.body, null, 2)
  details.append(pre)
  card.append(details)

  return card
}

async function poll(listNode, counterNode) {
  try {
    const res = await fetch(`/hook/${hookId()}/events`)
    if (!res.ok) throw new Error(`events returned ${res.status}`)
    const { events } = await res.json()
    latest = events
    seen = events.length
    counterNode.textContent = seen ? `${seen} received` : 'nothing yet'
    listNode.textContent = ''
    if (!events.length) {
      listNode.append(
        el('p', 'hint', 'Callbacks land here once a webhook pointed at the URL above fires.')
      )
      return
    }
    for (const event of events) listNode.append(renderEvent(event))
  } catch (err) {
    counterNode.textContent = 'cannot read callbacks'
    listNode.textContent = ''
    listNode.append(el('p', 'hint', String(err.message || err)))
  }
}

export function mountWebhooks(node) {
  container = node
  container.textContent = ''

  const urlRow = el('div', 'hook-url')
  const url = el('code', 'mono', hookUrl())
  const copy = el('button', 'btn-ghost', 'Copy')
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(hookUrl())
    copy.textContent = 'Copied'
    setTimeout(() => (copy.textContent = 'Copy'), 1200)
  })
  urlRow.append(url, copy)
  container.append(urlRow)

  const which = el('div', 'row-actions')
  const shared = hookId() === SHARED
  which.append(
    el(
      'span',
      'muted',
      shared
        ? 'Shared bucket — anything posted to this Worker with no /hook path arrives here.'
        : 'Private bucket — only callbacks sent to this exact path arrive here.'
    )
  )
  const swap = el('button', 'btn-ghost', shared ? 'Use a private URL' : 'Use the shared URL')
  swap.addEventListener('click', () => {
    setHookId(shared ? privateId() : SHARED)
    mountWebhooks(container)
  })
  which.append(swap)
  container.append(which)

  const steps = el('ol', 'steps')
  steps.append(el('li', null, 'Copy the URL above.'))
  steps.append(
    el('li', null, 'In the Up2Data dashboard, open Settings → Integrations → Create Webhook and paste it.')
  )
  steps.append(
    el('li', null, 'Give the webhook a tag such as test — then a request can name it in webhookTags and reach only this endpoint. Leave it untagged and every request on the team delivers here.')
  )
  steps.append(el('li', null, 'Back here, tick webhookTags on a request and enter that tag. The enqueue response echoes the webhooks it resolved to — an empty list there means nothing will be delivered.'))
  container.append(steps)

  container.append(
    el('p', 'warn', 'Anyone with this URL can read what arrives at it. Send test data only, and do not put a real secret in the webhook’s custom headers.')
  )

  const bar = el('div', 'row-actions')
  const counter = el('span', 'muted', 'nothing yet')
  const save = el('button', 'btn-ghost', 'Download JSON')
  save.addEventListener('click', () => {
    if (!latest.length) return
    // The bodies are what a receiving server would have been sent; the
    // wrapper keeps the arrival time and headers alongside them.
    downloadJson(latest, ['callbacks', hookId()])
  })
  const clear = el('button', 'btn-ghost danger', 'Clear')
  const list = el('div', 'callbacks')
  clear.addEventListener('click', async () => {
    await fetch(`/hook/${hookId()}`, { method: 'DELETE' })
    poll(list, counter)
  })
  bar.append(counter, save, clear)
  container.append(bar, list)

  if (timer) clearInterval(timer)
  poll(list, counter)
  timer = setInterval(() => poll(list, counter), 4000)
}
