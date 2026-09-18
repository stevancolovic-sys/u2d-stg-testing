// The burst panel: fire many live requests and watch the limiter.
//
// Only the live endpoints get this — they answer in the same response and
// share one rate limit, which is the thing worth measuring.

import { callApi } from '../api.js'
import { estimateCredits } from '../credits.js'
import { downloadJson } from '../download.js'
import { pickProfile, scheduleDelays, summarise, runPool } from '../burst.js'
import { openPicker } from './links.js'

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The field the endpoint takes one record in — profile or company.
const targetField = (endpoint) =>
  endpoint.fields.find((f) => f.type === 'text' && f.required)?.name

// What one request costs, taken from the endpoint's own formula so the flags
// on the form are accounted for.
function perRequestCost(endpoint, state) {
  const estimate = estimateCredits(endpoint, state)
  return estimate ? estimate.amount : 0
}

export function renderBurst(container, endpoint, state, getToken) {
  container.textContent = ''
  if (!endpoint.live) return

  let running = false
  let cancel = false

  container.append(el('h2', 'burst-head', 'Burst'))
  container.append(
    el(
      'p',
      'hint',
      'Fires many requests at once to see how the rate limiter behaves. The live endpoints share 10 requests per 10 seconds per team, and a 429 costs nothing — so overshooting is cheap, and the overshoot is the measurement.'
    )
  )

  // --- controls ---
  const controls = el('div', 'burst-controls')

  const targets = el('textarea', 'input textarea')
  targets.rows = 4
  targets.placeholder = 'johndoe\njanedoe\nacme-ceo'
  targets.spellcheck = false

  const count = el('input', 'input input-num')
  count.type = 'number'
  count.min = '1'
  count.max = '200'
  count.value = '20'

  const mode = el('select', 'input')
  for (const [value, label] of [
    ['rate', 'per second'],
    ['pool', 'at a time'],
  ]) {
    const option = el('option', null, label)
    option.value = value
    mode.append(option)
  }

  const rate = el('input', 'input input-num')
  rate.type = 'number'
  rate.min = '0'
  rate.value = '20'

  const field = (label, control, hint, linkTypes) => {
    const wrap = el('div', 'burst-field')
    const head = el('div', 'field-head')
    head.append(el('label', 'key mono', label))

    if (linkTypes) {
      const pick = el('button', 'btn-ghost', 'Insert saved')
      pick.type = 'button'
      pick.addEventListener('click', () =>
        openPicker(pick, linkTypes, (urls) => {
          const existing = control.value.split('\n').map((s) => s.trim()).filter(Boolean)
          control.value = [...new Set([...existing, ...urls])].join('\n')
          control.dispatchEvent(new Event('input', { bubbles: true }))
        })
      )
      head.append(pick)
    }

    wrap.append(head)
    wrap.append(control)
    if (hint) wrap.append(el('p', 'hint', hint))
    return wrap
  }

  const pacing = el('div', 'pacing')
  pacing.append(rate, mode)

  const pacingHint = el('p', 'hint')
  const describePacing = () => {
    const n = Math.max(0, Number(rate.value) || 0)
    if (mode.value === 'pool') {
      pacingHint.textContent =
        n <= 1
          ? 'One at a time: the next request is sent only after the previous one comes back. The honest measure of a single request, since running several at once inflates each one.'
          : `${n} in flight at once — a new one starts as soon as one finishes.`
    } else {
      pacingHint.textContent =
        n === 0
          ? 'Everything at once, on one breath. The hardest thing you can throw at the limiter.'
          : `${n} leave every second whether or not the earlier ones have answered.`
    }
  }
  rate.addEventListener('input', describePacing)
  mode.addEventListener('change', describePacing)

  controls.append(
    field(
      'targets',
      targets,
      'One per line — URLs or bare URN ids. The list cycles, so five entries can answer twenty requests; different targets stop you measuring a cache.',
      endpoint.id === 'company' ? ['company'] : ['profile']
    ),
    field('requests', count, 'How many to send in total.'),
    field('pacing', pacing, null)
  )
  controls.append(pacingHint)
  container.append(controls)
  describePacing()

  const estimate = el('p', 'burst-estimate')
  container.append(estimate)

  const actions = el('div', 'row-actions')
  const go = el('button', 'btn', 'Run burst')
  const stop = el('button', 'btn-ghost danger', 'Stop')
  stop.disabled = true
  const save = el('button', 'btn-ghost', 'Download run')
  save.disabled = true
  actions.append(go, stop, save)
  container.append(actions)

  const summaryBox = el('div', 'burst-summary')
  container.append(summaryBox)

  const table = el('div', 'burst-rows')
  container.append(table)

  let results = []

  function updateEstimate() {
    const n = Math.max(0, Number(count.value) || 0)
    const each = perRequestCost(endpoint, state)
    estimate.textContent =
      `Up to ${(n * each).toLocaleString('en-US')} credits — ${n} × ${each}, ` +
      'if every request is answered. Rate-limited ones cost nothing, so the real figure is usually lower.'
  }
  count.addEventListener('input', updateEstimate)
  updateEstimate()

  // --- summary ---
  function renderSummary() {
    summaryBox.textContent = ''
    if (!results.some((r) => r.finishedAt !== undefined)) return

    const s = summarise(results, perRequestCost(endpoint, state), Number(count.value) || undefined)

    const stat = (label, value, tone) => {
      const cell = el('div', 'stat')
      const v = el('span', 'stat-value', String(value))
      if (tone) v.classList.add(tone)
      cell.append(v)
      cell.append(el('span', 'stat-label', label))
      return cell
    }

    const seconds = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

    const grid = el('div', 'stats')
    grid.append(stat('sent of ' + s.requested, s.sent))
    grid.append(stat('succeeded', s.succeeded, s.succeeded ? 'ok' : null))
    grid.append(stat('did not', s.failed, s.failed ? 'bad' : null))
    grid.append(stat('per second', s.throughput))
    grid.append(stat('average each', seconds(s.avgMs)))
    grid.append(stat('all of them took', seconds(s.elapsedMs)))
    summaryBox.append(grid)

    const second = el('div', 'stats stats-minor')
    second.append(stat('p50', seconds(s.p50)))
    second.append(stat('p95', seconds(s.p95)))
    second.append(stat('waiting on server', seconds(s.avgWaitingMs)))
    second.append(stat('downloading', seconds(s.avgDownloadMs)))
    second.append(stat('response size', `${(s.avgBytes / 1024).toFixed(1)} KB`))
    second.append(stat('credits spent', s.credits))
    summaryBox.append(second)

    if (s.avgMs > 0) {
      const share = Math.round((s.avgWaitingMs / s.avgMs) * 100)
      summaryBox.append(
        el(
          'p',
          'hint',
          `${share}% of the average request was spent waiting for the API to answer — that is LinkedIn being scraped, not bytes moving. ` +
            'A finer breakdown (DNS, TCP, time to first byte) needs a Timing-Allow-Origin header the API does not send.'
        )
      )
    }

    if (s.failures.length) {
      summaryBox.append(el('div', 'label', 'Why the rest did not succeed'))
      for (const f of s.failures) {
        const row = el('div', 'failure')
        const code = el('span', 'mono')
        code.classList.add(f.status === 429 ? 'limited' : 'other')
        code.textContent = f.status === null ? 'transport' : String(f.status)
        row.append(code)
        row.append(el('span', 'failure-count mono', `× ${f.count}`))
        row.append(el('span', 'failure-why', f.reason))
        summaryBox.append(row)
      }
    }

    if (!s.sawRateLimitHeaders) {
      summaryBox.append(
        el(
          'p',
          'hint',
          'No RateLimit-* header came back on any response. The API lists them in access-control-expose-headers, so their absence means the limiter said nothing — not that you stayed under it.'
        )
      )
    }

    if (s.firstRateLimitAfterMs !== null) {
      summaryBox.append(
        el(
          'p',
          'hint',
          `First 429 arrived ${s.firstRateLimitAfterMs} ms into the run` +
            (s.retryAfterSeconds !== null ? `, asking for ${s.retryAfterSeconds}s before retrying.` : '.')
        )
      )
    }
  }

  // --- one row per request ---
  function rowFor(result) {
    const row = el('div', 'burst-row')
    row.append(el('span', 'mono muted', String(result.seq + 1).padStart(3, '0')))
    row.append(el('span', 'mono', result.target))

    const status = el('span', 'mono status-cell')
    if (result.transportError) {
      status.textContent = 'transport'
      status.classList.add('other')
    } else {
      status.textContent = String(result.status)
      status.classList.add(result.status === 200 ? 'ok' : result.status === 429 ? 'limited' : 'other')
    }
    row.append(status)

    const total = result.finishedAt - result.startedAt
    row.append(el('span', 'mono', `${total} ms`))
    if (Number.isFinite(result.waitingMs)) {
      row.append(
        el('span', 'mono muted', `server ${result.waitingMs} · download ${result.downloadMs}`)
      )
    }
    if (Number.isFinite(result.bytes)) {
      row.append(el('span', 'mono muted', `${(result.bytes / 1024).toFixed(1)} KB`))
    }

    const remaining = result.headers && result.headers['ratelimit-remaining']
    const retry = result.headers && result.headers['retry-after']
    if (remaining !== undefined) row.append(el('span', 'mono muted', `left ${remaining}`))
    if (retry !== undefined) row.append(el('span', 'mono muted', `retry ${retry}s`))

    return row
  }

  // --- the run ---
  async function run() {
    const list = targets.value.split('\n').map((s) => s.trim()).filter(Boolean)
    if (!list.length) {
      estimate.textContent = 'Add at least one target.'
      return
    }

    const token = getToken()
    if (!token) {
      estimate.textContent = 'Authenticate first.'
      return
    }

    const n = Math.min(200, Math.max(1, Number(count.value) || 1))
    const each = perRequestCost(endpoint, state)
    const worst = n * each

    const shape =
      mode.value === 'pool'
        ? `${Math.max(1, Number(rate.value) || 1)} at a time`
        : Number(rate.value) > 0
          ? `${Number(rate.value)} per second`
          : 'all at once'

    if (!confirm(`Send ${n} requests to ${endpoint.path}, ${shape}.\n\nUp to ${worst} credits if every one is answered; rate-limited requests cost nothing.\n\nRun it?`)) {
      return
    }

    running = true
    cancel = false
    results = []
    table.textContent = ''
    summaryBox.textContent = ''
    go.disabled = true
    stop.disabled = false
    save.disabled = true

    const name = targetField(endpoint)
    const startedRun = performance.now()

    const send = async (i) => {
      if (cancel) return
      const target = pickProfile(list, i)
      const record = { seq: i, target, startedAt: Math.round(performance.now() - startedRun) }
      results.push(record)

      const result = await callApi({
        endpoint,
        state: { ...state, [name]: { value: target } },
        token,
      })

      record.finishedAt = Math.round(performance.now() - startedRun)
      record.waitingMs = result.waitingMs
      record.downloadMs = result.downloadMs
      record.bytes = result.bytes
      record.status = result.status
      record.headers = result.headers || {}
      record.transportError = result.transportError
      record.body = result.body

      table.append(rowFor(record))
      renderSummary()
      return record
    }

    const indices = Array.from({ length: n }, (_, i) => i)

    if (mode.value === 'pool') {
      // Each request waits for a slot, so at a width of 1 they go one by one.
      await runPool(indices, Number(rate.value), (i) => send(i), () => cancel)
    } else {
      // Fired on a schedule, whether or not the earlier ones have answered.
      const delays = scheduleDelays(n, Number(rate.value))
      await Promise.all(
        delays.map(async (delay, i) => {
          if (delay) await sleep(delay)
          return send(i)
        })
      )
    }

    running = false
    go.disabled = false
    stop.disabled = true
    save.disabled = false
    renderSummary()
  }

  go.addEventListener('click', () => {
    if (!running) run()
  })

  stop.addEventListener('click', () => {
    cancel = true
    stop.disabled = true
  })

  save.addEventListener('click', () => {
    downloadJson(
      {
        endpoint: endpoint.path,
        ranAt: new Date().toISOString(),
        requested: Number(count.value),
        pacing: mode.value === 'pool' ? { inFlight: Number(rate.value) } : { perSecond: Number(rate.value) },
        summary: summarise(results, perRequestCost(endpoint, state), Number(count.value) || undefined),
        requests: results,
      },
      ['burst', endpoint.id]
    )
  })
}
