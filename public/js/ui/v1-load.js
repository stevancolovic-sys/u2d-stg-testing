// Volume testing against v1.
//
// Every v1 reply reports what it cost, so this spends by the meter rather
// than by estimate — and stops at a budget rather than after it.

import { V1_ENDPOINTS, v1ById } from '../v1-endpoints.js'
import { callV1 } from '../v1-api.js'
import { summariseV1Run, creditsOf, isSearch, searchOpsAmong, ratesOver, lastsFor } from '../v1-load.js'
import { stateFor } from './v1.js'
import { downloadJson } from '../download.js'
import { buildPools, targetSlotFor, nextTarget, runnable, KINDS, kindLabel } from '../targets.js'
import { currentLinks, loadLinks } from './links.js'

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

  const inFlight = num(10, 1, 200)
  const timeout = num(0, 0)

  const field = (label, control, hint) => {
    const wrap = el('div', 'burst-field')
    wrap.append(el('label', 'key mono', label))
    wrap.append(control)
    if (hint) wrap.append(el('p', 'hint', hint))
    return wrap
  }

  controls.append(
    field(
      'in flight',
      inFlight,
      'How many calls are kept running at once. The run keeps going, cycling operations and targets, until you stop it.'
    ),
    field('give up after', timeout, 'Seconds before abandoning a call. 0 waits. Abandoning still bills.')
  )
  container.append(controls)

  // --- pools of things to call with ---
  const pastedKey = 'up2data.v1load.pasted'
  let pasted = {}
  try {
    pasted = JSON.parse(localStorage.getItem(pastedKey) || '{}') || {}
  } catch {
    pasted = {}
  }

  const poolBox = el('details', 'options')
  poolBox.append(el('summary', null, 'Targets'))
  poolBox.append(
    el(
      'p',
      'hint',
      'Every call takes the next target from its pool, so the same one is not sent twice until the pool has been round — sending one URL over and over measures their cache, not their workers. Profiles come from Saved links. Posts and jobs have no seed: a made-up URN answers 422, which still bills and tells you nothing.'
    )
  )
  for (const kind of KINDS) {
    const wrap = el('div', 'burst-field wide')
    wrap.append(el('label', 'key mono', kindLabel[kind]))
    const box = el('textarea', 'input textarea')
    box.rows = 3
    box.spellcheck = false
    box.value = pasted[kind] || ''
    box.placeholder = kind === 'company' ? 'Leave empty to use a built-in list of real companies' : 'One per line'
    box.addEventListener('input', () => {
      pasted[kind] = box.value
      try { localStorage.setItem(pastedKey, JSON.stringify(pasted)) } catch {}
      refresh()
    })
    wrap.append(box)
    poolBox.append(wrap)
  }
  container.append(poolBox)

  const plan = el('p', 'burst-estimate')
  container.append(plan)

  const actions = el('div', 'row-actions')
  const go = el('button', 'btn btn-send', 'Start')
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
    const pools = buildPools({ saved: currentLinks(), pasted })
    const { ready, blocked } = runnable(ids.map(v1ById).filter(Boolean), pools)

    plan.textContent = ''
    const line = el('span')
    line.textContent =
      `${ready.length} operation${ready.length === 1 ? '' : 's'} ready, ` +
      `${Number(inFlight.value) || 0} in flight, cycling ` +
      KINDS.filter((k) => pools[k].length).map((k) => `${pools[k].length} ${k}s`).join(', ') +
      '.'
    plan.append(line)

    if (blocked.length) {
      plan.append(
        el(
          'span',
          'plan-blocked',
          ` ${blocked.length} cannot run without targets: ` +
            [...new Set(blocked.map((b) => b.needs))].join(', ') +
            ' — paste some under Targets.'
        )
      )
    }

    const searches = searchOpsAmong(ready)
    if (searches.length) {
      const left = account?.rate_limit?.searches_remaining_this_hour
      plan.append(
        el(
          'span',
          'plan-blocked',
          ` ${searches.length} are searches` +
            (Number.isFinite(left)
              ? `, and only ${left} are allowed this hour — the rest answer 429, free.`
              : '.')
        )
      )
    }

    go.disabled = running || !ready.length
  }

  // --- the run ---
  let spent = 0
  let issued = 0

  async function run() {
    const pools = buildPools({ saved: currentLinks(), pasted })
    const ids = [...picked]
    const { ready } = runnable(ids.map(v1ById).filter(Boolean), pools)
    if (!ready.length) return

    const ok = confirm(
      `Keep ${Number(inFlight.value)} calls in flight across ${ready.length} operations, continuously.\n\n` +
        'There is no limit — it runs until you press Stop, and every answered call is billed.\n\nStart?'
    )
    if (!ok) return

    running = true
    cancel = false
    results = []
    spent = 0
    issued = 0
    go.disabled = true
    stop.disabled = false
    save.disabled = true
    table.textContent = ''

    const startedRun = performance.now()
    const timeoutMs = Math.max(0, Number(timeout.value) || 0) * 1000

    // One worker per slot, each taking the next operation and the next target
    // for as long as the run lasts.
    const worker = async () => {
      while (!cancel) {
        const seq = issued++
        const endpoint = v1ById(ready[seq % ready.length])
        const state = { ...stateFor(endpoint) }

        const slot = targetSlotFor(endpoint)
        if (slot) {
          const target = nextTarget(pools[slot.kind], Math.floor(seq / ready.length))
          if (!target) continue
          state[slot.field] = { enabled: true, value: target }
          // Two ways to name the same thing; sending both is a bad request.
          const other = slot.field === 'url' ? 'urn' : 'url'
          if (state[other]) state[other] = { ...state[other], enabled: false, value: '' }
        }

        const record = {
          operationId: endpoint.id,
          target: slot ? state[slot.field].value : null,
          startedAt: Math.round(performance.now() - startedRun),
        }
        results.push(record)

        const result = await callV1({ endpoint, state, environment: getEnvironment(), timeoutMs })

        record.finishedAt = Math.round(performance.now() - startedRun)
        record.result = result
        const cost = creditsOf(result)
        if (cost !== null) spent += cost
      }
    }

    const width = Math.max(1, Number(inFlight.value) || 1)
    const ticker = setInterval(() => renderSummary(startedRun), 1000)

    await Promise.all(Array.from({ length: width }, worker))

    clearInterval(ticker)
    running = false
    go.disabled = false
    stop.disabled = true
    save.disabled = false
    renderSummary(startedRun)
    readAccount().then((d) => {
      account = d
      refresh()
    })
  }

  function renderSummary(startedRun) {
    const s = summariseV1Run(results, 0)
    const now = startedRun ? performance.now() - startedRun : 0
    const rates = ratesOver(results, now)
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

    const remaining = s.creditsRemaining ?? account?.credits_remaining ?? null
    const runway = lastsFor(remaining, rates.creditsPerMinute)

    const grid = el('div', 'stats')
    grid.append(stat('sent', s.sent))
    grid.append(stat('in flight', Math.max(0, results.length - s.sent)))
    grid.append(stat('per minute', rates.perMinute, running ? 'live' : null))
    grid.append(stat('credits / min', rates.creditsPerMinute.toLocaleString('en-US'), running ? 'live' : null))
    grid.append(stat('spent', s.credits.toLocaleString('en-US')))
    if (remaining !== null) grid.append(stat('left', remaining.toLocaleString('en-US')))
    if (runway) grid.append(stat('lasts about', runway, 'bad'))
    summary.append(grid)

    const second = el('div', 'stats stats-minor')
    second.append(stat('succeeded', s.succeeded, s.succeeded ? 'ok' : null))
    second.append(stat('did not', s.failed, s.failed ? 'bad' : null))
    second.append(stat('running for', seconds(s.elapsedMs)))
    summary.append(second)

    if (runway) {
      summary.append(
        el('p', 'hint', `At this rate the balance runs out in about ${runway}. Nothing stops this run but you.`)
      )
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

  // Saved links feed the profile pool, so make sure they are loaded.
  if (!currentLinks().length) loadLinks().then(refresh).catch(() => {})

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
