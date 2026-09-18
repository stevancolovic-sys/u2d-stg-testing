// Showing what came back as something readable, and letting it leave as a
// spreadsheet. Records arrive with dozens of nested fields; a table of the
// ones people actually look at beats a wall of JSON.

import { toRows, columnsFor, toCsv } from '../table.js'
import { downloadJson } from '../download.js'
import { jsonFilename } from '../download.js'

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function downloadCsv(rows, columns, name) {
  const csv = toCsv(rows, columns)
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = jsonFilename(name).replace(/\.json$/, '.csv')
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const show = (value) => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

export function renderResults(container, items, name) {
  container.textContent = ''
  const records = Array.isArray(items) ? items : [items]

  if (!records.length || !records[0]) {
    container.append(el('p', 'hint', 'Nothing came back.'))
    return
  }

  const rows = toRows(records)
  const columns = columnsFor(rows)

  const bar = el('div', 'row-actions')
  bar.append(el('span', 'muted', `${records.length} record${records.length === 1 ? '' : 's'}`))

  const csv = el('button', 'btn-ghost', 'Download CSV')
  csv.addEventListener('click', () => downloadCsv(rows, columns, name))

  const json = el('button', 'btn-ghost', 'Download JSON')
  json.addEventListener('click', () => downloadJson(records, name))

  const toggle = el('button', 'btn-ghost', 'Show raw JSON')
  bar.append(csv, json, toggle)
  container.append(bar)

  const wrap = el('div', 'table-wrap')
  const table = el('table', 'results')

  const head = el('tr')
  for (const column of columns) head.append(el('th', null, column))
  table.append(head)

  for (const row of rows) {
    const tr = el('tr')
    for (const column of columns) {
      const cell = el('td', null, show(row[column]))
      cell.title = show(row[column])
      tr.append(cell)
    }
    table.append(tr)
  }
  wrap.append(table)
  container.append(wrap)

  const raw = el('pre', 'json')
  raw.textContent = JSON.stringify(records, null, 2)
  raw.hidden = true
  container.append(raw)

  toggle.addEventListener('click', () => {
    raw.hidden = !raw.hidden
    wrap.hidden = !raw.hidden
    toggle.textContent = raw.hidden ? 'Show raw JSON' : 'Show table'
  })

  if (columns.length >= 14) {
    container.append(
      el('p', 'hint', 'Showing the first 14 columns — the CSV carries every one.')
    )
  }
}
