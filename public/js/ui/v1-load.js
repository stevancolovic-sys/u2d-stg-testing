// Volume testing against v1.
//
// Every v1 reply reports what it cost, so this spends by the meter rather
// than by estimate — and stops at a budget rather than after it.

import { V1_ENDPOINTS, v1ById } from '../v1-endpoints.js'
import { callV1 } from '../v1-api.js'
import { runPool, scheduleDelays } from '../burst.js'
import { planRun, summariseV1Run, budgetReached, creditsOf, isSearch, searchOpsAmong } from '../v1-load.js'
import { stateFor } from './v1.js'
import { downloadJson } from '../download.js'

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PICKED_KEY = 'up2data.v1load.picked'

export function mountV1Load(container, { getEnvironment = () => 'staging' } = {}) {
  container.textContent = ''

  let picked = new Set()
  try {
    const saved = JSON.parse(localStorage.getItem(PICKED_KEY) || 'null')
    if (Array.isArray(saved)) picked = new Set(saved.filter((id) => v1ById(id)))
  } catch {
    /* start with nothing picked */
  }
  if (!picked.size) picked.add('profiles-enrich')

  let cancel = false
  let running = false
  let results = []

  // --- what the account says before we spend anything ---
  const standing = el('div', 'v1-standing')
  container.append(standing)

  async function readAccount() {
    standing.textContent = 'Reading your balance…'
    const account = v1ById('account-get')
    const result = await callV1({ endpoint: account, state: {}, environment: getEnvironment() })
    standing.textContent = ''

    if (!result.ok || !result.body?.data) {
      standing.append(el('p', 'hint', result.workerError === 'no_key'
        ? `No v1 key saved for ${getEnvironment()} — add one under API keys.`
        : 'Could not read your balance, so nothing here knows what you have left.'))
      return null
    }

    const d = result.body.data
    const grid = el('div', 'stats')
    const stat = (label, value, tone) => {
      const cell = el('div', 'stat')
      const v = el('span', 'stat-value', String(value))
      if (tone) v.classList.add(tone)
      cell.append(v, el('span', 'stat-label', label))
      return cell
    }
    grid.append(stat('credits', (d.credits_remaining ?? 0).toLocaleString('en-US')))
    grid.append(stat('used this month', (d.credits_used_this_month ?? 0).toLocaleString('en-US')))
    if (d.rate_limit) {
      grid.append(stat('per minute', d.rate_limit.requests_per_minute))
      grid.append(
        stat(
          'searches left this hour',
          d.rate_limit.searches_remaining_this_hour,
          d.rate_limit.searches_remaining_this_hour === 0 ? 'bad' : null
        )
      )
    }
    standing.append(grid)
    return d
  }

  let account = null
  readAccount().then((d) => {
    account = d
    refresh()
  })

  // --- which operations ---
  container.append(el('div', 'label', 'What to call'))
  const list = el('div', 'op-picker')
  container.append(list)

  let group = null
  for (const e of V1_ENDPOINTS) {
    if (e.id === 'account-get') continue // free, and not worth volume
    if (e.group !== group) {
      group = e.group
      list.append(el('div', 'op-group', group))
    }
    const row = el('label', 'op-row')
    const box = el('input')
    box.type = 'checkbox'
    box.checked = picked.has(e.id)
    box.addEventListener('change', () => {
      if (box.checked) picked.add(e.id)
      else picked.delete(e.id)
      try { localStorage.setItem(PICKED_KEY, JSON.stringify([...picked])) } catch {}
      refresh()
    })
    row.append(box, el('span', null, e.label))
    row.append(el('span', 'mono muted', `${e.method} ${e.path}`))
    if (isSearch(e)) row.append(el('span', 'chip', 'hourly limit'))
    list.append(row)
  }

  const pickAll = el('button', 'btn-ghost', 'Select all')
  const pickNone = el('button', 'btn-ghost', 'Select none')
  pickAll.addEventListener('click', () => {
    for (const e of V1_ENDPOINTS) if (e.id !== 'account-get') picked.add(e.id)
    remount()
  })
  pickNone.addEventListener('click', () => {
    picked.clear()
    remount()
  })
  const pickRow = el('div', 'row-actions')
  pickRow.append(pickAll, pickNone)
  container.append(pickRow)

  function remount() {
    try { localStorage.setItem(PICKED_KEY, JSON.stringify([...picked])) } catch {}
    mountV1Load(container, { getEnvironment })
  }

  // --- how much, how fast, how much may it cost ---
  const controls = el('div', 'burst-controls')

  const num = (value, min, max) => {
    const input = el('input', 'input input-num')
    input.type = 'number'
    input.min = String(min)
    if (max !== undefined) input.max = String(max)
    input.value = String(value)
    input.addEventListener('input', refresh)
    return input
  }

  const perOp = num(5, 1, 500)
  const rate = num(2, 0)
  const mode = el('select', 'input')
  for (const [value, label] of [['pool', 'at a time'], ['rate', 'per second']]) {
    const option = el('option', null, label)
    option.value = value
    mode.append(option)
  }
  mode.addEventListener('change', refresh)
  const timeout = num(0, 0)
  const budget = num(500, 0)

  const field = (label, control, hint) => {
    const wrap = el('div', 'burst-field')
    wrap.append(el('label', 'key mono', label))
    wrap.append(control)
    if (hint) wrap.append(el('p', 'hint', hint))
    return wrap
  }

  const pacing = el('div', 'pacing')
  pacing.append(rate, mode)

  controls.append(
    field('calls each', perOp, 'How many times to call every operation you ticked.'),
    field('pacing', pacing, 'At a time keeps that many in flight. Per second fires on a schedule.'),
    field('give up after', timeout, 'Seconds before abandoning a call. 0 waits.'),
    field('stop at', budget, 'Credits. The run stops once the API says this much has been spent.')
  )
  container.append(controls)

  const plan = el('p', 'burst-estimate')
  container.append(plan)

  const actions = el('div', 'row-actions')
  const go = el('button', 'btn btn-send', 'Run')
  const stop = el('button', 'btn-ghost danger', 'Stop')
  stop.disabled = true
  const save = el('button', 'btn-ghost', 'Download run')
  save.disabled = true
  actions.append(go, stop, save)
  container.append(actions)

  const summary = el('div', 'burst-summary')
  const table = el('div', 'v1-op-results')
  container.append(summary, table)

  function refresh() {
    const ids = [...picked]
    const calls = ids.length * (Number(perOp.value) || 0)
    const searches = searchOpsAmong(ids)
    const searchCalls = searches.length * (Number(perOp.value) || 0)

    const bits = [`${calls} call${calls === 1 ? '' : 's'} across ${ids.length} operation${ids.length === 1 ? '' : 's'}`]
    if (Number(budget.value) > 0) bits.push(`stopping at ${Number(budget.value).toLocaleString('en-US')} credits`)
    plan.textContent = bits.join(', ') + '.'

    if (searchCalls) {
      const left = account?.rate_limit?.searches_remaining_this_hour
      plan.textContent +=
        ` ${searchCalls} of them are searches` +
        (Number.isFinite(left) ? `, and you have ${left} left this hour — the rest will come back 429, which costs nothing.` : '.')
    }

    go.disabled = running || !ids.length || !(Number(perOp.value) > 0)
  }

  // --- the run ---
  async function run() {
    const ids = [...picked]
    const calls = ids.length * Number(perOp.value)
    const cap = Number(budget.value) || 0

    const ok = confirm(
      `Send ${calls} calls across ${ids.length} operations.\n\n` +
        (cap ? `Stopping once ${cap.toLocaleString('en-US')} credits have been spent.` : 'With no credit limit.') +
        '\n\nRun it?'
    )
    if (!ok) return

    running = true
    cancel = false
    results = []
    go.disabled = true
    stop.disabled = false
    save.disabled = true
    table.textContent = ''

    const items = planRun(ids, Number(perOp.value))
    const startedRun = performance.now()
    const timeoutMs = Math.max(0, Number(timeout.value) || 0) * 1000
    let spent = 0

    const send = async (item, i) => {
      if (cancel || budgetReached(spent, cap)) return
      const endpoint = v1ById(item.operationId)
      const record = {
        operationId: item.operationId,
        startedAt: Math.round(performance.now() - startedRun),
      }
      results.push(record)

      const result = await callV1({
        endpoint,
        state: stateFor(endpoint),
        environment: getEnvironment(),
        timeoutMs,
      })

      record.finishedAt = Math.round(performance.now() - startedRun)
      record.result = result
      const cost = creditsOf(result)
      if (cost !== null) spent += cost

      renderSummary(cap)
      return record
    }

    if (mode.value === 'pool') {
      await runPool(items, Number(rate.value) || 1, send, () => cancel || budgetReached(spent, cap))
    } else {
      const delays = scheduleDelays(items.length, Number(rate.value))
      await Promise.all(
        delays.map(async (delay, i) => {
          if (delay) await sleep(delay)
          return send(items[i], i)
        })
      )
    }

    running = false
    go.disabled = false
    stop.disabled = true
    save.disabled = false
    renderSummary(cap)
    readAccount().then((d) => {
      account = d
      refresh()
    })
  }

  function renderSummary(cap) {
    const s = summariseV1Run(results, cap)
    summary.textContent = ''
    if (!s.sent) return

    const stat = (label, value, tone) => {
      const cell = el('div', 'stat')
      const v = el('span', 'stat-value', String(value))
      if (tone) v.classList.add(tone)
      cell.append(v, el('span', 'stat-label', label))
      return cell
    }
    const seconds = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

    const grid = el('div', 'stats')
    grid.append(stat(`sent of ${results.length}`, s.sent))
    grid.append(stat('succeeded', s.succeeded, s.succeeded ? 'ok' : null))
    grid.append(stat('did not', s.failed, s.failed ? 'bad' : null))
    grid.append(stat('credits spent', s.credits.toLocaleString('en-US'), 'live'))
    if (s.creditsRemaining !== null) grid.append(stat('left', s.creditsRemaining.toLocaleString('en-US')))
    grid.append(stat('took', seconds(s.elapsedMs)))
    summary.append(grid)

    if (s.stoppedOnBudget) {
      summary.append(el('p', 'hint', `Stopped: the budget of ${cap.toLocaleString('en-US')} credits was reached.`))
    }
    if (s.unknownCost) {
      summary.append(
        el('p', 'hint', `${s.unknownCost} repl${s.unknownCost === 1 ? 'y' : 'ies'} reported no cost, so the figure above is a floor.`)
      )
    }

    table.textContent = ''
    table.append(el('div', 'label', 'By operation'))
    for (const op of s.operations) {
      const row = el('div', 'v1-op-row')
      row.append(el('span', 'mono', op.operationId))
      row.append(el('span', 'muted', `${op.succeeded}/${op.sent} ok`))
      row.append(el('span', 'mono', `${op.credits} cr`))
      row.append(el('span', 'muted', `avg ${seconds(op.avgMs)} · p95 ${seconds(op.p95)}`))
      row.append(el('span', 'failure-why', op.reasons.map((r) => `${r.reason} × ${r.count}`).join(', ')))
      table.append(row)
    }
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
        ranAt: new Date().toISOString(),
        environment: getEnvironment(),
        operations: [...picked],
        callsEach: Number(perOp.value),
        budget: Number(budget.value) || null,
        summary: summariseV1Run(results, Number(budget.value) || 0),
        calls: results,
      },
      ['v1-load', getEnvironment()]
    )
  })

  refresh()
}
