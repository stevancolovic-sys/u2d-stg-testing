import { ENDPOINTS, byId } from './endpoints.js'
import { estimateCredits } from './credits.js'
import { buildBody, toCurl } from './request.js'
import { callApi, resolveUrl } from './api.js'
import { initialState, renderForm, refreshMarkers } from './ui/form.js'
import { renderResponse, captureQueues, renderResolvedWebhooks } from './ui/response.js'
import { mountQueues, addQueues } from './ui/queues.js'
import { mountWebhooks } from './ui/webhooks.js'

const TOKEN_KEY = 'up2data.auth'
const LAST_KEY = 'up2data.endpoint'
const stateKey = (id) => `up2data.state.${id}`
const $ = (sel) => document.querySelector(sel)

let current = null
let state = {}

// --- credentials ---------------------------------------------------------

const readAuth = () => {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null')
  } catch {
    return null
  }
}
const writeAuth = (auth) => localStorage.setItem(TOKEN_KEY, JSON.stringify(auth))
const getToken = () => readAuth()?.token || null

function hoursLeft(auth) {
  if (!auth?.issuedAt) return 0
  const elapsed = Date.now() - new Date(auth.issuedAt).getTime()
  return Math.max(0, 24 - elapsed / 3600000)
}

function renderAuth() {
  const auth = readAuth()
  const status = $('#auth-status')
  const keyInput = $('#api-key')

  if (auth?.apiKey && !keyInput.value) keyInput.value = auth.apiKey

  if (!auth?.token) {
    status.textContent = 'No token. Authenticate to enable the other endpoints.'
    status.className = 'auth-status'
  } else {
    const left = hoursLeft(auth)
    if (left <= 0) {
      status.textContent = 'Token expired. Authenticate again.'
      status.className = 'auth-status expired'
    } else {
      const h = Math.floor(left)
      const m = Math.floor((left - h) * 60)
      status.textContent = `Token valid for ${h}h ${m}m`
      status.className = 'auth-status live'
    }
  }
  if (current) renderPreview()
}

async function authenticate() {
  const apiKey = $('#api-key').value.trim()
  if (!apiKey) return
  const btn = $('#auth-btn')
  btn.disabled = true
  btn.textContent = 'Authenticating…'

  const result = await callApi({
    endpoint: byId('authenticate'),
    state: { apiKey: { value: apiKey } },
    token: null,
  })

  btn.disabled = false
  btn.textContent = 'Get token'
  renderResponse($('#response'), result)

  if (result.body?.accessToken) {
    writeAuth({ apiKey, token: result.body.accessToken, issuedAt: new Date().toISOString() })
  }
  renderAuth()
}

// --- endpoint rail -------------------------------------------------------

function renderRail() {
  const rail = $('#rail')
  rail.textContent = ''
  let group = null

  for (const endpoint of ENDPOINTS) {
    if (endpoint.group !== group) {
      group = endpoint.group
      const heading = document.createElement('div')
      heading.className = 'rail-group'
      heading.textContent = group
      rail.append(heading)
    }
    const btn = document.createElement('button')
    btn.className = 'rail-item'
    btn.dataset.id = endpoint.id
    if (current && endpoint.id === current.id) btn.classList.add('on')

    const label = document.createElement('span')
    label.className = 'mono'
    label.textContent = endpoint.label
    btn.append(label)

    const method = document.createElement('span')
    method.className = `verb ${endpoint.method.toLowerCase()}`
    method.textContent = endpoint.method
    btn.append(method)

    btn.addEventListener('click', () => selectEndpoint(endpoint.id))
    rail.append(btn)
  }
}

// --- form + preview ------------------------------------------------------

function loadState(endpoint) {
  const base = initialState(endpoint)
  try {
    const saved = JSON.parse(localStorage.getItem(stateKey(endpoint.id)) || 'null')
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

const saveState = () => localStorage.setItem(stateKey(current.id), JSON.stringify(state))

function renderPreview() {
  const url = resolveUrl(current, state)
  const token = getToken()

  const lines = [`${current.method} ${url}`]
  if (current.method !== 'GET') lines.push('Content-Type: application/json')
  if (current.auth) lines.push(`Authorization: ${token ? token.slice(0, 18) + '…' : '(no token)'}`)
  $('#preview-head').textContent = lines.join('\n')

  const body = current.method === 'GET' ? null : buildBody(current.fields, state)
  $('#preview-body').textContent = body ? JSON.stringify(body, null, 2) : '(no body)'

  const estimate = estimateCredits(current, state)
  const meter = $('#meter')
  meter.textContent = ''
  if (!estimate) {
    meter.classList.add('free')
    meter.append(Object.assign(document.createElement('span'), { className: 'meter-note', textContent: 'No credits' }))
  } else {
    meter.classList.remove('free')
    meter.classList.toggle('reserved', Boolean(estimate.reserved))
    const amount = document.createElement('span')
    amount.className = 'meter-amount'
    amount.textContent = estimate.amount.toLocaleString('en-US')
    const unit = document.createElement('span')
    unit.className = 'meter-unit'
    unit.textContent = estimate.reserved ? 'credits reserved' : 'credits'
    const note = document.createElement('span')
    note.className = 'meter-note'
    note.textContent = estimate.note
    meter.append(amount, unit, note)
  }

  const send = $('#send')
  const blocked = current.auth && !token
  send.disabled = blocked
  $('#send-note').textContent = blocked ? 'Authenticate first — this endpoint needs a token.' : ''
}

function onChange() {
  saveState()
  refreshMarkers($('#form'), current, state)
  renderPreview()
}

function selectEndpoint(id) {
  current = byId(id)
  state = loadState(current)
  localStorage.setItem(LAST_KEY, id)

  for (const btn of document.querySelectorAll('.rail-item')) {
    btn.classList.toggle('on', btn.dataset.id === id)
  }

  $('#endpoint-label').textContent = current.label
  $('#endpoint-summary').textContent = current.summary
  $('#endpoint-path').textContent = `${current.method} ${current.path}`

  renderForm($('#form'), current, state, onChange)
  renderPreview()
}

// --- sending -------------------------------------------------------------

async function send() {
  const estimate = estimateCredits(current, state)

  // Only the search endpoints can reserve thousands from one click, and an
  // unchecked limit is the way that happens by accident.
  if (estimate?.reserved && estimate.amount > 0) {
    const ok = confirm(
      `This reserves up to ${estimate.amount.toLocaleString('en-US')} credits.\n\n` +
        `${estimate.note}\n\nSend it?`
    )
    if (!ok) return
  }

  const btn = $('#send')
  btn.disabled = true
  btn.textContent = 'Sending…'

  const result = await callApi({ endpoint: current, state, token: getToken() })

  btn.disabled = false
  btn.textContent = 'Send request'

  renderResponse($('#response'), result)
  renderResolvedWebhooks($('#resolved-webhooks'), result.body)

  if (current.id === 'authenticate' && result.body?.accessToken) {
    writeAuth({
      apiKey: state.apiKey?.value || readAuth()?.apiKey || '',
      token: result.body.accessToken,
      issuedAt: new Date().toISOString(),
    })
    renderAuth()
  }

  const ids = captureQueues(result.body)
  if (ids.length) {
    addQueues(ids, { endpointId: current.id, name: state.name?.value || '' })
    $('#tab-queues').click()
  }

  // A 429 on a live endpoint says exactly how long to wait.
  const retry = Number(result.headers?.['retry-after'])
  if (result.status === 429 && retry > 0) {
    btn.disabled = true
    let left = retry
    $('#send-note').textContent = `Rate limited — retry in ${left}s`
    const countdown = setInterval(() => {
      left -= 1
      if (left <= 0) {
        clearInterval(countdown)
        btn.disabled = false
        $('#send-note').textContent = ''
      } else {
        $('#send-note').textContent = `Rate limited — retry in ${left}s`
      }
    }, 1000)
  }
}

// --- tabs ----------------------------------------------------------------

function setupTabs() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.tab')) other.classList.remove('on')
      for (const panel of document.querySelectorAll('.panel')) panel.hidden = true
      tab.classList.add('on')
      document.querySelector(`#${tab.dataset.panel}`).hidden = false
    })
  }
}

// --- boot ----------------------------------------------------------------

renderRail()
setupTabs()
selectEndpoint(localStorage.getItem(LAST_KEY) || 'authenticate')
renderAuth()
setInterval(renderAuth, 60000)

mountQueues($('#queues'), { getToken })
mountWebhooks($('#webhooks'))

$('#auth-btn').addEventListener('click', authenticate)
$('#api-key').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') authenticate()
})
$('#clear-auth').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY)
  $('#api-key').value = ''
  renderAuth()
})
$('#send').addEventListener('click', send)
$('#copy-curl').addEventListener('click', async () => {
  const cmd = toCurl({
    method: current.method,
    url: resolveUrl(current, state),
    token: current.auth ? getToken() : null,
    body: current.method === 'GET' ? null : buildBody(current.fields, state),
  })
  await navigator.clipboard.writeText(cmd)
  const btn = $('#copy-curl')
  btn.textContent = 'Copied'
  setTimeout(() => (btn.textContent = 'Copy as curl'), 1200)
})
