// The v1 surface: every operation the published spec defines, rendered from
// the generated registry so nothing is missing and nothing is invented.

import { V1_ENDPOINTS, v1ById, V1_BASES } from '../v1-endpoints.js'
import { buildV1Body, jsonErrors, missingV1Required } from '../v1-request.js'
import { callV1, describeV1, v1Curl } from '../v1-api.js'
import { initialState, renderFields } from './form.js'
import { renderResponse } from './response.js'
import { renderResults } from './results.js'

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const stateKey = (id) => `up2data.v1.${id}`

let current = null
let state = {}
let root = null
let getEnvironment = () => 'staging'

function loadState(endpoint) {
  // Every field's starting value is the example's own, set by the generator.
  const base = initialState(endpoint)
  try {
    const saved = JSON.parse(localStorage.getItem(stateKey(endpoint.id)) || 'null')
    if (saved) for (const name of Object.keys(base)) if (saved[name]) base[name] = { ...base[name], ...saved[name] }
  } catch {
    /* a corrupt entry just means starting fresh */
  }
  return base
}

const saveState = () => localStorage.setItem(stateKey(current.id), JSON.stringify(state))

export function v1Groups() {
  const groups = new Map()
  for (const e of V1_ENDPOINTS) {
    if (!groups.has(e.group)) groups.set(e.group, [])
    groups.get(e.group).push(e)
  }
  return [...groups.entries()].map(([name, endpoints]) => ({ name, endpoints }))
}

export function selectV1(id) {
  current = v1ById(id) || V1_ENDPOINTS[0]
  state = loadState(current)
  localStorage.setItem('up2data.v1.last', current.id)
  draw()
}

export const currentV1 = () => current

export function mountV1(node, context = {}) {
  root = node
  if (context.getEnvironment) getEnvironment = context.getEnvironment
  selectV1(localStorage.getItem('up2data.v1.last') || V1_ENDPOINTS[0].id)
}

function draw() {
  if (!root || !current) return
  root.textContent = ''

  const head = el('div', 'job-head')
  head.append(el('h1', null, current.label))
  head.append(el('code', 'mono job-path', `${current.method} ${current.path}`))
  root.append(head)
  if (current.summary) root.append(el('p', 'lede', current.summary))

  // The spec marks almost nothing required, so "what the example sends" is
  // what gets asked for up front — otherwise most of these opened blank.
  const primary = current.fields.filter((f) => f.primary)
  const rest = current.fields.filter((f) => !f.primary)

  if (current.takesNothing) {
    root.append(el('p', 'hint', 'This call takes no input — just send it.'))
  } else if (primary.length) {
    const step = el('section', 'step')
    step.append(el('div', 'step-head', 'What to send'))
    step.append(
      el('p', 'hint', 'Filled in from the example in the API documentation. Replace the values with your own.')
    )
    const box = el('div', 'fields')
    step.append(box)
    root.append(step)
    renderFields(box, primary, state, onChange)
  }

  if (rest.length) {
    const details = el('details', 'options')
    const on = rest.filter((f) => state[f.name]?.enabled).length
    details.append(el('summary', null, on ? `Everything else — ${on} set` : `Everything else — ${rest.length} more`))
    const box = el('div', 'fields')
    details.append(box)
    root.append(details)
    renderFields(box, rest, state, onChange)
  }

  const dispatch = el('section', 'dispatch')
  const note = el('p', 'hint')
  const send = el('button', 'btn btn-send', 'Send')

  const curl = el('button', 'btn-ghost', 'Copy as curl')
  curl.addEventListener('click', async () => {
    await navigator.clipboard.writeText(v1Curl(current, state, getEnvironment()))
    curl.textContent = 'Copied'
    setTimeout(() => (curl.textContent = 'Copy as curl'), 1200)
  })

  const actions = el('div', 'dispatch-actions')
  actions.append(send, curl)
  dispatch.append(actions, note)
  root.append(dispatch)

  const detail = el('details', 'request-detail')
  detail.append(el('summary', null, 'Show the exact request'))
  const pre = el('pre', 'json')
  detail.append(pre)
  root.append(detail)

  const out = el('section', 'outcome')
  root.append(out)

  function refresh() {
    const missing = missingV1Required(current, state)
    const broken = jsonErrors(current, state)
    const body = buildV1Body(current, state)
    const nothing =
      !current.takesNothing &&
      !Object.keys(body || {}).length &&
      !current.fields.some((f) => f.in === 'path' && String(state[f.name]?.value || '').trim())

    const blocked = missing.length
      ? `Still needed: ${missing.join(', ')}.`
      : broken.length
        ? `${broken.join(', ')} is not valid JSON.`
        : nothing
          ? 'Nothing filled in — this would go out empty.'
          : ''

    send.disabled = Boolean(blocked)
    note.textContent = blocked
    pre.textContent = describeV1(current, state, getEnvironment())
  }

  send.addEventListener('click', async () => {
    send.disabled = true
    send.textContent = 'Sending…'
    out.textContent = ''

    const result = await callV1({ endpoint: current, state, environment: getEnvironment() })

    send.disabled = false
    send.textContent = 'Send'

    if (result.workerError === 'no_key') {
      out.append(
        el('p', 'hint', `No v1 key saved for ${getEnvironment()} — add one under API keys.`)
      )
      return
    }

    // v1 answers {data, meta}; an array of records is worth a table.
    const rows = result.body && Array.isArray(result.body.data) ? result.body.data : null
    if (result.ok && rows && rows.length) {
      const meta = el('p', 'hint')
      const bits = [`${rows.length} record${rows.length === 1 ? '' : 's'}`]
      if (result.apiMs) bits.push(`API took ${(result.apiMs / 1000).toFixed(1)}s`)
      if (result.body.meta) bits.push(JSON.stringify(result.body.meta))
      meta.textContent = bits.join(' · ')
      out.append(meta)
      renderResults(out, rows, ['v1', current.id])
    } else {
      renderResponse(out, result, `v1-${current.id}`)
      if (result.apiMs) out.append(el('p', 'hint', `The API itself took ${(result.apiMs / 1000).toFixed(1)}s.`))
    }
  })

  window.__refreshV1 = refresh
  refresh()
}

function onChange() {
  saveState()
  if (window.__refreshV1) window.__refreshV1()
}

export const v1Base = (environment) => V1_BASES[environment] || V1_BASES.staging
