import { byId } from './endpoints.js'
import { JOBS, jobById, modeOf, targetField, optionalFields, otherRequiredFields, missingRequired, suggestedName } from './jobs.js'
import { estimateCredits } from './credits.js'
import { buildBody, toCurl, parseLines } from './request.js'
import { callApi, resolveUrl, probeReachable } from './api.js'
import { runPool } from './burst.js'
import { PRESETS, getBase, setBase, presetFor } from './config.js'
import { initialState, renderFields } from './ui/form.js'
import { renderResponse } from './ui/response.js'
import { renderResults } from './ui/results.js'
import { renderBurst } from './ui/burst.js'
import { mountQueues, addQueues, setJobsVisible, render as renderQueues } from './ui/queues.js'
import { mountWebhooks } from './ui/webhooks.js'
import { mountLinks } from './ui/links.js'
import { mountKeys, onKeysChanged, knownKeys } from './ui/keys.js'
import { tokenFor, freshToken, clearToken, currentEnvironment, environmentLabel } from './keys.js'

const WHERE_KEY = 'up2data.where'
const stateKey = (jobId, modeId) => `up2data.job.${jobId}.${modeId}`
const $ = (sel) => document.querySelector(sel)

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const PANELS = [
  { id: 'jobs', label: 'Jobs', node: 'panel-jobs' },
  { id: 'callbacks', label: 'Callbacks', node: 'panel-callbacks' },
  { id: 'links', label: 'Saved links', node: 'panel-links' },
  { id: 'burst', label: 'Load test', node: 'panel-burst' },
  { id: 'keys', label: 'API keys', node: 'panel-keys' },
]

let where = { kind: 'job', id: JOBS[0].id }
let tokenReady = false
let keyMissing = false
let job = null
let mode = null
let state = {}

// --- the API key --------------------------------------------------------

// Held by the Worker against this account. A token is minted from it on
// demand, so nothing here ever holds the key and nothing expires in a way
// anyone has to think about.
let token = null

async function ensureToken() {
  if (token) return token
  token = await tokenFor()
  return token
}

// Used by panels that make their own calls.
const getToken = () => token

function renderKeyStatus() {
  const status = $('#key-status')
  const environment = currentEnvironment()

  if (!environment) {
    status.textContent = 'Custom API — no saved key for this address'
    status.className = 'auth-status expired'
    return
  }

  const keys = knownKeys()
  const state = keys && keys[environment]

  if (state && state.set) {
    status.textContent = `${environmentLabel(environment)} key ${state.hint}`
    status.className = 'auth-status live'
  } else if (keys) {
    status.textContent = `No ${environmentLabel(environment).toLowerCase()} key — add one under API keys`
    status.className = 'auth-status expired'
  }
}

// --- where you are -------------------------------------------------------

function renderRail() {
  const rail = $('#rail')
  rail.textContent = ''

  rail.append(el('div', 'rail-group', 'Enrich'))
  for (const j of JOBS) {
    const btn = el('button', 'rail-item')
    btn.dataset.where = `job:${j.id}`
    btn.append(el('span', 'rail-title', j.title))
    btn.append(el('span', 'rail-blurb', j.blurb))
    btn.addEventListener('click', () => go({ kind: 'job', id: j.id }))
    rail.append(btn)
  }

  rail.append(el('div', 'rail-group', 'Track'))
  for (const p of PANELS) {
    const btn = el('button', 'rail-item rail-plain')
    btn.dataset.where = `panel:${p.id}`
    btn.append(el('span', 'rail-title', p.label))
    btn.addEventListener('click', () => go({ kind: 'panel', id: p.id }))
    rail.append(btn)
  }
  markRail()
}

function markRail() {
  for (const btn of document.querySelectorAll('.rail-item')) {
    btn.classList.toggle('on', btn.dataset.where === `${where.kind}:${where.id}`)
  }
}

function go(next) {
  where = next
  localStorage.setItem(WHERE_KEY, JSON.stringify(where))
  markRail()

  $('#job').hidden = where.kind !== 'job'
  for (const p of PANELS) $(`#${p.node}`).hidden = !(where.kind === 'panel' && where.id === p.id)

  // Jobs update themselves while you are looking at them, and stop when you
  // are not — an open tab should not poll forever.
  setJobsVisible(where.kind === 'panel' && where.id === 'jobs')

  if (where.kind === 'job') selectJob(where.id)
}

// --- a job ---------------------------------------------------------------

function loadState(endpoint, jobId, modeId) {
  const base = initialState(endpoint)
  try {
    const saved = JSON.parse(localStorage.getItem(stateKey(jobId, modeId)) || 'null')
    if (saved) {
      for (const name of Object.keys(base)) {
        if (saved[name]) base[name] = { ...base[name], ...saved[name] }
      }
    }
  } catch {
    /* a corrupt entry just means starting fresh */
  }
  return base
}

const saveState = () => localStorage.setItem(stateKey(job.id, mode.id), JSON.stringify(state))

function selectJob(id, modeId) {
  job = jobById(id) || JOBS[0]
  mode = modeOf(job, modeId || localStorage.getItem(`up2data.mode.${job.id}`) || job.modes[0].id)
  localStorage.setItem(`up2data.mode.${job.id}`, mode.id)
  state = loadState(byId(mode.endpoint), job.id, mode.id)

  if (state.name && !String(state.name.value || '').trim()) {
    state.name.value = suggestedName(job)
  }

  draw()
}

function endpointsFor() {
  const endpoint = byId(mode.endpoint)
  if (endpoint.route) return endpoint.route(state).map(byId).filter(Boolean)
  return [endpoint]
}

function targetCount() {
  const endpoint = byId(mode.endpoint)
  const field = targetField(endpoint)
  if (!field) return 0
  const entry = state[field.name]
  if (field.type === 'links') return (entry?.value || []).filter((r) => r.url.trim()).length
  if (field.type === 'lines') return parseLines(entry?.value).length
  return String(entry?.value || '').trim() ? 1 : 0
}

function draw() {
  const root = $('#job')
  root.textContent = ''
  const endpoint = byId(mode.endpoint)

  const heading = el('div', 'job-head')
  heading.append(el('h1', null, job.title))
  heading.append(el('code', 'mono job-path', `${endpoint.method} ${endpoint.path}`))
  root.append(heading)
  root.append(el('p', 'lede', job.blurb))

  // --- step 1: which shape ---
  if (job.modes.length > 1) {
    const step = el('section', 'step')
    step.append(el('div', 'step-head', 'How do you want it?'))
    const choices = el('div', 'choices')
    for (const m of job.modes) {
      const choice = el('button', 'choice' + (m.id === mode.id ? ' on' : ''))
      const head = el('span', 'choice-head')
      head.append(el('span', 'choice-label', m.label))
      // The endpoint it calls, so the label and the API are plainly the same
      // thing to anyone who has read the docs.
      head.append(el('span', 'choice-path mono', byId(m.endpoint).path))
      choice.append(head)
      choice.append(el('span', 'choice-blurb', m.blurb))
      choice.addEventListener('click', () => selectJob(job.id, m.id))
      choices.append(choice)
    }
    step.append(choices)
    root.append(step)
  }

  // --- step 2: who ---
  const who = el('section', 'step')
  who.append(el('div', 'step-head', job.question))
  const fields = el('div', 'fields')
  who.append(fields)
  root.append(who)

  const shown = [targetField(endpoint)].filter(Boolean)
  const listsField = endpoint.fields.find((f) => f.type === 'lists')
  if (mode.lists && listsField) shown.push(listsField)
  // name and priority are required too; leaving them unrendered sent an empty
  // name and the API refused the queue.
  shown.push(...otherRequiredFields(endpoint))
  renderFields(fields, shown, state, onChange)

  // --- step 3: options ---
  const optional = optionalFields(endpoint)
  if (optional.length) {
    const details = el('details', 'options')
    const on = optional.filter((f) => state[f.name]?.enabled).length
    details.append(el('summary', null, on ? `Options — ${on} set` : 'Options'))
    const optionFields = el('div', 'fields')
    details.append(optionFields)
    renderFields(optionFields, optional, state, onChange)
    root.append(details)
  }

  // --- send ---
  const dispatch = el('section', 'dispatch')
  const meter = el('div', 'meter')
  dispatch.append(meter)

  const actions = el('div', 'dispatch-actions')
  const send = el('button', 'btn btn-send', 'Send')
  const note = el('p', 'hint')
  actions.append(send)

  const curl = el('button', 'btn-ghost', 'Copy as curl')
  curl.addEventListener('click', async () => {
    const text = endpointsFor()
      .map((e) =>
        toCurl({
          method: e.method,
          url: resolveUrl(e, state),
          token: e.auth ? getToken() : null,
          body: e.method === 'GET' ? null : buildBody(e.fields, state),
        })
      )
      .join('\n\n')
    await navigator.clipboard.writeText(text)
    curl.textContent = 'Copied'
    setTimeout(() => (curl.textContent = 'Copy as curl'), 1200)
  })
  actions.append(curl)
  dispatch.append(actions, note)
  root.append(dispatch)

  // --- the exact request, for when it matters ---
  const detail = el('details', 'request-detail')
  detail.append(el('summary', null, 'Show the exact request'))
  const pre = el('pre', 'json')
  detail.append(pre)
  root.append(detail)

  const out = el('section', 'outcome')
  root.append(out)

  function refresh() {
    const route = endpointsFor()
    const n = targetCount()
    const estimate = estimateCredits(endpoint, state)

    meter.textContent = ''
    if (estimate && estimate.amount) {
      meter.classList.toggle('reserved', Boolean(estimate.reserved))
      meter.append(el('span', 'meter-amount', estimate.amount.toLocaleString('en-US')))
      meter.append(el('span', 'meter-unit', estimate.reserved ? 'credits held' : 'credits'))
      meter.append(el('span', 'meter-note', estimate.note))
    } else {
      meter.append(el('span', 'meter-note', n ? 'Nothing to spend.' : 'Add at least one above.'))
    }

    const missing = missingRequired(endpoint, state)
    const blocked = !tokenReady
      ? keyMissing
        ? 'No API key for this environment — add one under API keys.'
        : 'Getting a token…'
      : !route.length
        ? 'Pick at least one list.'
        : missing.length
          ? `Still needed: ${missing.join(', ')}.`
          : ''
    send.disabled = Boolean(blocked)
    note.textContent = blocked
    send.textContent = mode.oneAtATime && n > 1 ? `Send ${n}, one at a time` : 'Send'

    pre.textContent = route
      .map((e) => {
        const body = e.method === 'GET' ? null : buildBody(e.fields, state)
        return `${e.method} ${resolveUrl(e, state)}\n` + (body ? JSON.stringify(body, null, 2) : '(no body)')
      })
      .join('\n\n')
  }

  send.addEventListener('click', () => run(endpoint, out, send, refresh))
  window.__refreshJob = refresh
  refresh()

  // A token is fetched once per environment and reused; the button unlocks
  // the moment it arrives.
  ensureToken().then(() => {
    tokenReady = Boolean(token)
    keyMissing = !token
    refresh()
  })
}

function onChange() {
  saveState()
  if (window.__refreshJob) window.__refreshJob()
}

// --- sending -------------------------------------------------------------

async function run(endpoint, out, send, refresh) {
  const estimate = estimateCredits(endpoint, state)

  if (estimate?.reserved && estimate.amount > 0) {
    const ok = confirm(
      `This holds up to ${estimate.amount.toLocaleString('en-US')} credits.\n\n${estimate.note}\n\nGo ahead?`
    )
    if (!ok) return
  }

  send.disabled = true
  out.textContent = ''
  const progress = el('p', 'hint', 'Sending…')
  out.append(progress)

  await ensureToken()
  const field = targetField(endpoint)

  // Live endpoints take one record each, so a list becomes a queue of calls —
  // one at a time, because several at once inflates every reading.
  if (mode.oneAtATime) {
    const targets = parseLines(state[field.name]?.value)
    const records = []
    const failures = []

    await runPool(targets, 1, async (target, i) => {
      progress.textContent = `Sending ${i + 1} of ${targets.length}…`
      let result = await callApi({
        endpoint,
        state: { ...state, [field.name]: { value: target } },
        token,
      })
      if (result.status === 401) {
        token = await freshToken()
        result = await callApi({
          endpoint,
          state: { ...state, [field.name]: { value: target } },
          token,
        })
      }
      if (result.ok && result.body) {
        records.push(result.body)
      } else {
        if (result.transportError && failures.length === 0) {
          result.probeOk = await probeReachable(token)
        }
        failures.push({ target, result })
      }
    })

    out.textContent = ''
    if (records.length) renderResults(out, records, [job.id, mode.id])
    if (failures.length) {
      out.append(el('div', 'label', `${failures.length} did not come back`))
      for (const f of failures) {
        const row = el('div', 'failure')
        row.append(el('span', 'mono', f.target))
        row.append(
          el('span', 'failure-why', f.result.transportError || f.result.body?.message || `status ${f.result.status}`)
        )
        out.append(row)
      }
    }
    send.disabled = false
    refresh()
    return
  }

  // Everything else enqueues and is watched on the Jobs panel.
  const queueIds = []
  let last = null

  for (const e of endpointsFor()) {
    let result = await callApi({ endpoint: e, state, token })
    // A token lasts a day; if it has gone stale, mint another and try once.
    if (result.status === 401) {
      token = await freshToken()
      result = await callApi({ endpoint: e, state, token })
    }
    // A browser cannot see the status of a response with no CORS headers, so
    // ask the API something cheap to find out whether it is up at all.
    if (result.transportError) {
      progress.textContent = 'That failed without a status — checking whether the API is up…'
      result.probeOk = await probeReachable(token)
    }
    last = result
    if (result.body) {
      queueIds.push(...(result.body.queueId ? [result.body.queueId] : []))
      queueIds.push(...(Array.isArray(result.body.queueIds) ? result.body.queueIds : []))
    }
  }

  out.textContent = ''
  send.disabled = false
  refresh()

  if (queueIds.length) {
    const said = last?.body || {}
    addQueues(queueIds, {
      endpointId: endpoint.id,
      name: state.name?.value || job.title,
      // What the API reported when it took the job: what it kept, what it
      // dropped and why. Nowhere else to get it once the response is gone.
      submitted: targetCount(),
      enqueued: said.enqueued,
      skipped: said.skipped,
      webhooks: said.webhooks,
    })
    const hooks = last?.body?.webhooks
    const line = el('p', 'sent-ok')
    line.textContent =
      `Sent. ${queueIds.length === 1 ? 'One job' : `${queueIds.length} jobs`} running — ` +
      (hooks && hooks.length
        ? `results will also be pushed to ${hooks.map((h) => h.name).join(', ')}.`
        : 'watch it under Jobs.')
    out.append(line)
    const open = el('button', 'btn-ghost', 'Open Jobs')
    open.addEventListener('click', () => go({ kind: 'panel', id: 'jobs' }))
    out.append(open)
  } else {
    renderResponse(out, last, job.id)
  }
}

// --- which API -----------------------------------------------------------

function renderPresets() {
  const wrap = $('#base-presets')
  wrap.textContent = ''
  const active = presetFor(getBase())
  for (const preset of PRESETS) {
    const btn = el('button', 'preset' + (active && active.id === preset.id ? ' on' : ''), preset.label)
    btn.type = 'button'
    btn.addEventListener('click', () => {
      $('#base-url').value = setBase(preset.url)
      clearToken()
      token = null
      renderPresets()
      renderKeyStatus()
      ensureToken().then(() => {
        tokenReady = Boolean(token)
        keyMissing = !token
        if (where.kind === 'job') draw()
      })
      if (where.kind === 'job') draw()
    })
    wrap.append(btn)
  }
}

function setupBaseUrl() {
  const input = $('#base-url')
  input.value = getBase()
  input.addEventListener('input', () => {
    setBase(input.value)
    clearToken()
    token = null
    renderPresets()
    renderKeyStatus()
    if (where.kind === 'job') draw()
  })
  renderPresets()
}

// --- load test -----------------------------------------------------------

function setupBurst() {
  const wrap = $('#burst-kind')
  let kind = 'profile'
  const draw = () => {
    wrap.textContent = ''
    for (const [id, label] of [['profile', 'People'], ['company', 'Companies']]) {
      const btn = el('button', 'preset' + (id === kind ? ' on' : ''), label)
      btn.type = 'button'
      btn.addEventListener('click', () => {
        kind = id
        draw()
      })
      wrap.append(btn)
    }
    const endpoint = byId(kind)
    renderBurst($('#burst'), endpoint, initialState(endpoint), getToken)
  }
  draw()
}

// --- boot ----------------------------------------------------------------

renderRail()
setupBaseUrl()
setupBurst()
mountQueues($('#queues'), { getToken })
mountWebhooks($('#webhooks'))
mountLinks($('#links'))
mountKeys($('#keys'))
onKeysChanged(() => {
  renderKeyStatus()
  ensureToken().then(() => {
    tokenReady = Boolean(token)
    keyMissing = !token
    if (where.kind === 'job') draw()
  })
})

try {
  const saved = JSON.parse(localStorage.getItem(WHERE_KEY) || 'null')
  if (saved && (saved.kind === 'job' ? jobById(saved.id) : PANELS.some((p) => p.id === saved.id))) {
    where = saved
  }
} catch {
  /* start at the first job */
}
go(where)
renderKeyStatus()
ensureToken().then(() => {
  tokenReady = Boolean(token)
  keyMissing = !token
  if (where.kind === 'job') draw()
  // Ticks that ran before the token arrived did nothing; nudge them now.
  setJobsVisible(where.kind === 'panel' && where.id === 'jobs')
  renderQueues()
})
