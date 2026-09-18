import { ENDPOINTS, VISIBLE, byId } from './endpoints.js'
import { estimateCredits } from './credits.js'
import { buildBody, toCurl } from './request.js'
import { callApi, resolveUrl } from './api.js'
import { PRESETS, getBase, setBase, presetFor } from './config.js'
import { initialState, renderForm, refreshMarkers } from './ui/form.js'
import { renderResponse, captureQueues, renderResolvedWebhooks } from './ui/response.js'
import { mountQueues, addQueues } from './ui/queues.js'
import { mountWebhooks } from './ui/webhooks.js'
import { renderBurst } from './ui/burst.js'
import { mountLinks } from './ui/links.js'

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
  renderResponse($('#response'), result, 'authenticate')

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

  for (const endpoint of VISIBLE) {
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

// An endpoint may fan out: the activity picker turns one click into one
// request per list it selected.
function routeOf(endpoint, formState) {
  const ids = endpoint.route ? endpoint.route(formState) : [endpoint.id]
  return ids.map(byId).filter(Boolean)
}

function describeRequest(endpoint, formState, token) {
  const lines = [`${endpoint.method} ${resolveUrl(endpoint, formState)}`]
  if (endpoint.method !== 'GET') lines.push('Content-Type: application/json')
  if (endpoint.auth) lines.push(`Authorization: ${token ? token.slice(0, 18) + '…' : '(no token)'}`)
  const body = endpoint.method === 'GET' ? null : buildBody(endpoint.fields, formState)
  lines.push('')
  lines.push(body ? JSON.stringify(body, null, 2) : '(no body)')
  return lines.join('\n')
}

function renderPreview() {
  const token = getToken()
  const route = routeOf(current, state)

  if (!route.length) {
    $('#preview-head').textContent = 'Nothing selected — no request will be sent.'
    $('#preview-body').textContent = ''
  } else {
    $('#preview-head').textContent =
      route.length === 1 ? '1 request' : `${route.length} requests, sent in order`
    $('#preview-body').textContent = route
      .map((endpoint) => describeRequest(endpoint, state, token))
      .join('\n\n' + '─'.repeat(40) + '\n\n')
  }

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
  const noToken = current.auth && !token
  const nothingPicked = route.length === 0
  send.disabled = noToken || nothingPicked
  send.textContent = route.length > 1 ? `Send ${route.length} requests` : 'Send request'
  $('#send-note').textContent = noToken
    ? 'Authenticate first — this endpoint needs a token.'
    : nothingPicked
      ? 'Pick at least one list.'
      : ''
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

  // Only the live endpoints answer in the same response and share one rate
  // limit, so only they have anything to burst.
  const burstTab = $('#tab-burst')
  burstTab.hidden = !current.live
  if (current.live) {
    renderBurst($('#burst'), current, state, getToken)
  } else if (burstTab.classList.contains('on')) {
    // Leaving a live endpoint with the burst tab open would show a blank pane.
    document.querySelector('.tab[data-panel="panel-response"]').click()
  }

  renderPreview()
}

// --- sending -------------------------------------------------------------

async function send() {
  const estimate = estimateCredits(current, state)
  const route = routeOf(current, state)
  if (!route.length) return

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
  const label = btn.textContent
  btn.disabled = true

  const responses = $('#response')
  responses.textContent = ''
  $('#resolved-webhooks').textContent = ''

  const queueIds = []
  let lastResult = null

  for (const [i, endpoint] of route.entries()) {
    btn.textContent = route.length > 1 ? `Sending ${i + 1} of ${route.length}…` : 'Sending…'
    const result = await callApi({ endpoint, state, token: getToken() })
    lastResult = result

    const block = document.createElement('div')
    block.className = 'response-block'
    if (route.length > 1) {
      const head = document.createElement('div')
      head.className = 'label mono'
      head.textContent = `${endpoint.method} ${endpoint.path}`
      block.append(head)
    }
    const body = document.createElement('div')
    block.append(body)
    responses.append(block)
    renderResponse(body, result, endpoint.id)

    if (result.body) {
      renderResolvedWebhooks($('#resolved-webhooks'), result.body)
      queueIds.push(...captureQueues(result.body))
    }

    if (endpoint.id === 'authenticate' && result.body?.accessToken) {
      writeAuth({
        apiKey: state.apiKey?.value || readAuth()?.apiKey || '',
        token: result.body.accessToken,
        issuedAt: new Date().toISOString(),
      })
      renderAuth()
    }
  }

  btn.disabled = false
  btn.textContent = label

  if (queueIds.length) {
    addQueues(queueIds, { endpointId: current.id, name: state.name?.value || '' })
    $('#tab-queues').click()
  }

  // A 429 on a live endpoint says exactly how long to wait.
  const retry = Number(lastResult?.headers?.['retry-after'])
  if (lastResult?.status === 429 && retry > 0) {
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

// --- which API ------------------------------------------------------------

function renderPresets() {
  const wrap = $('#base-presets')
  wrap.textContent = ''
  const active = presetFor(getBase())
  for (const preset of PRESETS) {
    const btn = document.createElement('button')
    btn.className = 'preset'
    btn.type = 'button'
    btn.textContent = preset.label
    if (active && active.id === preset.id) btn.classList.add('on')
    btn.addEventListener('click', () => {
      $('#base-url').value = setBase(preset.url)
      renderPresets()
      renderPreview()
    })
    wrap.append(btn)
  }
}

function setupBaseUrl() {
  const input = $('#base-url')
  input.value = getBase()
  input.addEventListener('input', () => {
    setBase(input.value)
    renderPresets()
    renderPreview()
  })
  // A token is issued by one environment and meaningless to the other.
  input.addEventListener('change', () => {
    input.value = getBase()
    renderPresets()
  })
  renderPresets()
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
setupBaseUrl()
// The reference page links here as ?endpoint=<id>; a hidden id resolves too,
// so a link to /posts lands on the activity picker that covers it.
const asked = new URLSearchParams(location.search).get('endpoint')
const askedEndpoint = asked && byId(asked)
selectEndpoint(
  askedEndpoint ? (askedEndpoint.hidden ? 'activity' : askedEndpoint.id) : localStorage.getItem(LAST_KEY) || 'authenticate'
)
renderAuth()
setInterval(renderAuth, 60000)

mountQueues($('#queues'), { getToken })
mountWebhooks($('#webhooks'))
mountLinks($('#links'))

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
  const cmd = routeOf(current, state)
    .map((endpoint) =>
      toCurl({
        method: endpoint.method,
        url: resolveUrl(endpoint, state),
        token: endpoint.auth ? getToken() : null,
        body: endpoint.method === 'GET' ? null : buildBody(endpoint.fields, state),
      })
    )
    .join('\n\n')
  await navigator.clipboard.writeText(cmd)
  const btn = $('#copy-curl')
  btn.textContent = 'Copied'
  setTimeout(() => (btn.textContent = 'Copy as curl'), 1200)
})
