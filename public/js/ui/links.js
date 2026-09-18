// Saved Links: a library of the URLs you keep pasting, typed so the console
// can offer only the ones a given field accepts.

import { TYPES, typeById, detectType, describe, normaliseLink, dedupeKey, filterLinks, splitPasted } from '../links.js'
import { downloadJson } from '../download.js'

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

let cache = []
const listeners = new Set()

const announce = () => listeners.forEach((fn) => fn(cache))
export const onLinksChanged = (fn) => listeners.add(fn)

export async function loadLinks() {
  const res = await fetch('/links')
  if (!res.ok) throw new Error(`links returned ${res.status}`)
  const { links } = await res.json()
  cache = links.map(normaliseLink)
  announce()
  return cache
}

export async function saveLinks(inputs) {
  const payload = inputs.map((input) => {
    const link = normaliseLink(input)
    return { ...link, key: dedupeKey(link.url), id: link.id || crypto.randomUUID().slice(0, 12) }
  })
  const res = await fetch('/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`save returned ${res.status}`)
  const { links } = await res.json()
  cache = links.map(normaliseLink)
  announce()
  return cache
}

export async function deleteLink(id) {
  const res = await fetch(`/links?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  const { links } = await res.json()
  cache = links.map(normaliseLink)
  announce()
  return cache
}

export const currentLinks = () => cache

// --- the picker a form field opens ---------------------------------------

export function openPicker(anchor, acceptedTypes, onInsert) {
  // The button sits in a flex row; a picker appended there becomes a flex
  // child, gets squeezed into a narrow column and overlaps its neighbours.
  // It belongs to the whole field.
  const mount = anchor.closest('.field, .burst-field') || anchor.parentElement

  const existing = mount.querySelector('.picker')
  if (existing) {
    existing.remove()
    return
  }

  const picker = el('div', 'picker')
  const search = el('input', 'input')
  search.type = 'search'
  search.placeholder = 'Filter saved links'
  picker.append(search)

  const list = el('div', 'picker-list')
  picker.append(list)

  const chosen = new Set()

  const draw = () => {
    list.textContent = ''
    const matching = filterLinks(cache, { query: search.value }).filter((l) =>
      acceptedTypes.includes(l.type)
    )

    if (!matching.length) {
      list.append(
        el(
          'p',
          'hint',
          cache.length
            ? `Nothing saved of the kind this field takes (${acceptedTypes.map((t) => typeById(t)?.label || t).join(', ')}).`
            : 'Nothing saved yet — add links on the Saved links tab.'
        )
      )
      return
    }

    for (const link of matching) {
      const row = el('label', 'picker-row')
      const box = el('input')
      box.type = 'checkbox'
      box.checked = chosen.has(link.url)
      box.title = link.url
      box.addEventListener('change', () => {
        if (box.checked) chosen.add(link.url)
        else chosen.delete(link.url)
        insert.textContent = `Insert ${chosen.size || ''}`.trim()
      })

      row.append(box)
      // For a URN the label is the URN, so showing both prints it twice.
      if (link.label && link.label !== link.url) {
        row.append(el('span', 'picker-name', link.label))
        row.append(el('span', 'mono muted picker-url', link.url))
      } else {
        row.append(el('span', 'mono picker-url', link.url))
      }
      list.append(row)
    }
  }

  search.addEventListener('input', draw)

  const actions = el('div', 'row-actions')

  const all = el('button', 'btn-ghost', 'Select all')
  all.addEventListener('click', () => {
    const showing = filterLinks(cache, { query: search.value }).filter((l) =>
      acceptedTypes.includes(l.type)
    )
    const everyOne = showing.every((l) => chosen.has(l.url))
    for (const link of showing) {
      if (everyOne) chosen.delete(link.url)
      else chosen.add(link.url)
    }
    all.textContent = everyOne ? 'Select all' : 'Select none'
    draw()
    insert.textContent = `Insert ${chosen.size || ''}`.trim()
  })
  actions.append(all)

  const insert = el('button', 'btn-ghost', 'Insert')
  insert.addEventListener('click', () => {
    if (chosen.size) onInsert([...chosen])
    picker.remove()
  })
  const close = el('button', 'btn-ghost', 'Close')
  close.addEventListener('click', () => picker.remove())
  actions.append(insert, close)
  picker.append(actions)

  mount.append(picker)
  draw()
  search.focus()
}

// --- the page ------------------------------------------------------------

export function mountLinks(container) {
  container.textContent = ''

  const form = el('div', 'link-form')
  const url = el('input', 'input')
  url.type = 'text'
  url.placeholder = 'https://www.linkedin.com/in/johndoe'
  const label = el('input', 'input')
  label.type = 'text'
  label.placeholder = 'Name it (optional)'
  const tags = el('input', 'input')
  tags.type = 'text'
  tags.placeholder = 'tags, comma separated (optional)'

  const typeSelect = el('select', 'input')
  const autoOption = el('option', null, 'Detect from the URL')
  autoOption.value = ''
  typeSelect.append(autoOption)
  for (const t of TYPES) {
    const option = el('option', null, t.label)
    option.value = t.id
    typeSelect.append(option)
  }

  const detected = el('p', 'hint')
  url.addEventListener('input', () => {
    const type = detectType(url.value)
    detected.textContent = type
      ? `Recognised as ${typeById(type).label} — used by ${typeById(type).feeds}.`
      : url.value.trim()
        ? 'Not a LinkedIn URL this console recognises — pick a type so it knows which fields can take it.'
        : ''
    if (!label.value) label.placeholder = describe(url.value) || 'Name it (optional)'
  })

  const add = el('button', 'btn', 'Save link')
  const status = el('p', 'hint')

  add.addEventListener('click', async () => {
    const value = url.value.trim()
    if (!value) return
    add.disabled = true
    try {
      await saveLinks([{ url: value, label: label.value, tags: tags.value, type: typeSelect.value || undefined }])
      url.value = ''
      label.value = ''
      tags.value = ''
      typeSelect.value = ''
      detected.textContent = ''
      status.textContent = 'Saved.'
      setTimeout(() => (status.textContent = ''), 1500)
    } catch (err) {
      status.textContent = String(err.message || err)
    }
    add.disabled = false
  })

  form.append(url, label, tags, typeSelect, add)
  container.append(form, detected, status)

  // --- pasting a list ---
  const bulk = el('details', 'bulk')
  bulk.append(el('summary', null, 'Paste a list'))

  const bulkBox = el('textarea', 'input textarea')
  bulkBox.rows = 6
  bulkBox.placeholder =
    'One per line — URLs or bare URN ids\nACoAAAFQVg8Bl5-CNIAKaZpnJnNUZp6WQul09V0\nhttps://www.linkedin.com/in/johndoe'
  bulkBox.spellcheck = false

  const bulkTags = el('input', 'input')
  bulkTags.type = 'text'
  bulkTags.placeholder = 'tags for all of them (optional)'

  const bulkType = el('select', 'input')
  const bulkAuto = el('option', null, 'Detect each from its value')
  bulkAuto.value = ''
  bulkType.append(bulkAuto)
  for (const t of TYPES) {
    const option = el('option', null, `All are ${t.label}`)
    option.value = t.id
    bulkType.append(option)
  }

  const bulkCount = el('p', 'hint')
  const readBulk = () => splitPasted(bulkBox.value)

  const describeBulk = () => {
    const values = readBulk()
    if (!values.length) {
      bulkCount.textContent = ''
      return
    }
    const chosen = bulkType.value
    const counts = {}
    let unknown = 0
    for (const value of values) {
      const type = chosen || detectType(value)
      if (type) counts[type] = (counts[type] || 0) + 1
      else unknown += 1
    }
    const parts = Object.entries(counts).map(([id, n]) => `${n} ${typeById(id).label.toLowerCase()}`)
    if (unknown) parts.push(`${unknown} of no recognisable type`)
    bulkCount.textContent = `${values.length} to save — ${parts.join(', ')}.` +
      (unknown ? ' Pick a type above so the untyped ones can be offered to a field.' : '')
  }

  bulkBox.addEventListener('input', describeBulk)
  bulkType.addEventListener('change', describeBulk)

  const bulkSave = el('button', 'btn', 'Save all')
  bulkSave.addEventListener('click', async () => {
    const values = readBulk()
    if (!values.length) return
    bulkSave.disabled = true
    bulkSave.textContent = `Saving ${values.length}…`
    try {
      await saveLinks(
        values.map((value) => ({ url: value, tags: bulkTags.value, type: bulkType.value || undefined }))
      )
      bulkBox.value = ''
      bulkTags.value = ''
      bulkCount.textContent = `Saved ${values.length}.`
    } catch (err) {
      bulkCount.textContent = String(err.message || err)
    }
    bulkSave.disabled = false
    bulkSave.textContent = 'Save all'
  })

  const bulkRow = el('div', 'link-form')
  bulkRow.append(bulkTags, bulkType, bulkSave)
  bulk.append(bulkBox, bulkRow, bulkCount)
  container.append(bulk)

  // --- filters ---
  const filters = el('div', 'row-actions')
  const search = el('input', 'input')
  search.type = 'search'
  search.placeholder = 'Search saved links'
  filters.append(search)

  let activeType = null
  const chips = el('div', 'link-types')
  const drawChips = () => {
    chips.textContent = ''
    const all = el('button', 'chip' + (activeType === null ? ' on' : ''), `All ${cache.length}`)
    all.addEventListener('click', () => {
      activeType = null
      render()
    })
    chips.append(all)
    for (const t of TYPES) {
      const n = cache.filter((l) => l.type === t.id).length
      const chip = el('button', 'chip' + (activeType === t.id ? ' on' : ''), `${t.label} ${n}`)
      chip.addEventListener('click', () => {
        activeType = activeType === t.id ? null : t.id
        render()
      })
      chips.append(chip)
    }
  }

  const copyAll = el('button', 'btn-ghost', 'Copy all')
  const saveAll = el('button', 'btn-ghost', 'Download JSON')
  filters.append(copyAll, saveAll)

  // Both act on what is on screen, so a type chip or a search narrows them —
  // "copy all" after filtering to Profile copies the profiles, not the lot.
  const showing = () => filterLinks(cache, { type: activeType, query: search.value })

  copyAll.addEventListener('click', async () => {
    const values = showing().map((l) => l.url)
    if (!values.length) return
    try {
      await navigator.clipboard.writeText(values.join('\n'))
      copyAll.textContent = `Copied ${values.length}`
    } catch {
      copyAll.textContent = 'Copy blocked'
    }
    setTimeout(() => (copyAll.textContent = `Copy all ${showing().length}`), 1600)
  })

  saveAll.addEventListener('click', () => {
    const links = showing()
    if (!links.length) return
    downloadJson(links, ['saved-links', activeType || 'all'])
  })

  const listNode = el('div', 'link-list')
  container.append(filters, chips, listNode)

  function render() {
    drawChips()
    listNode.textContent = ''

    const matching = showing()
    // The count belongs on the button: it says what a click will take.
    copyAll.textContent = `Copy all ${matching.length}`
    copyAll.disabled = !matching.length
    saveAll.disabled = !matching.length
    if (!matching.length) {
      listNode.append(
        el('p', 'hint', cache.length ? 'Nothing matches that.' : 'No links saved yet. Paste one above.')
      )
      return
    }

    for (const link of matching) {
      const row = el('div', 'link-row')
      const type = typeById(link.type)
      row.append(el('span', 'chip', type ? type.label : 'untyped'))
      row.append(el('span', 'link-label', link.label))

      const anchor = el('a', 'mono muted link-url')
      anchor.href = link.url
      anchor.target = '_blank'
      anchor.rel = 'noreferrer noopener'
      anchor.textContent = link.url
      row.append(anchor)

      if (link.tags.length) row.append(el('span', 'muted', link.tags.join(' · ')))

      const copy = el('button', 'btn-ghost', 'Copy')
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(link.url)
        copy.textContent = 'Copied'
        setTimeout(() => (copy.textContent = 'Copy'), 1200)
      })

      const remove = el('button', 'btn-ghost danger', 'Delete')
      remove.addEventListener('click', async () => {
        await deleteLink(link.id)
      })

      row.append(copy, remove)
      listNode.append(row)
    }
  }

  search.addEventListener('input', render)
  onLinksChanged(render)

  loadLinks()
    .then(render)
    .catch((err) => {
      listNode.textContent = ''
      listNode.append(el('p', 'hint', `Could not load saved links: ${err.message}`))
    })
}
