// Draws one endpoint's form from its registry entry.
//
// Required fields sit plain. Every optional field leads with a checkbox that
// decides whether the key is sent at all — the row dims when it is off, and
// the request preview loses the key at the same moment. That pairing is the
// point of the tool, so it is made as visible as possible.

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function initialState(endpoint) {
  const state = {}
  for (const field of endpoint.fields) {
    state[field.name] = {
      enabled: false,
      value: field.type === 'links' ? [{ url: '', limitEnabled: false, limit: '' }] : field.default ?? '',
    }
  }
  return state
}

function renderLinks(field, entry, onChange) {
  const wrap = el('div', 'links')

  const draw = () => {
    wrap.textContent = ''
    entry.value.forEach((row, i) => {
      const rowEl = el('div', 'link-row')

      const url = el('input', 'input link-url')
      url.type = 'text'
      url.placeholder = 'https://www.linkedin.com/sales/search/people?query=…'
      url.value = row.url || ''
      url.addEventListener('input', () => {
        row.url = url.value
        onChange()
      })
      rowEl.append(url)

      const limitWrap = el('label', 'link-limit')
      const limitBox = el('input')
      limitBox.type = 'checkbox'
      limitBox.checked = Boolean(row.limitEnabled)
      const limitNum = el('input', 'input input-num')
      limitNum.type = 'number'
      limitNum.min = '1'
      limitNum.max = String(field.max)
      limitNum.placeholder = String(field.max)
      limitNum.value = row.limit ?? ''
      limitNum.disabled = !row.limitEnabled
      limitBox.addEventListener('change', () => {
        row.limitEnabled = limitBox.checked
        limitNum.disabled = !limitBox.checked
        onChange()
      })
      limitNum.addEventListener('input', () => {
        row.limit = limitNum.value
        onChange()
      })
      limitWrap.append(limitBox, el('span', 'mono', 'limit'), limitNum)
      rowEl.append(limitWrap)

      if (entry.value.length > 1) {
        const remove = el('button', 'btn-ghost', 'Remove')
        remove.type = 'button'
        remove.addEventListener('click', () => {
          entry.value.splice(i, 1)
          draw()
          onChange()
        })
        rowEl.append(remove)
      }

      wrap.append(rowEl)
    })

    const add = el('button', 'btn-ghost', 'Add link')
    add.type = 'button'
    add.addEventListener('click', () => {
      entry.value.push({ url: '', limitEnabled: false, limit: '' })
      draw()
      onChange()
    })
    wrap.append(add)
  }

  draw()
  return wrap
}

function renderControl(field, entry, onChange) {
  if (field.type === 'links') return renderLinks(field, entry, onChange)

  if (field.type === 'lines' || field.type === 'tags') {
    const box = el('textarea', 'input textarea')
    box.rows = field.type === 'tags' ? 2 : 5
    box.placeholder = field.placeholder || (field.type === 'tags' ? 'prod\nstaging' : '')
    box.value = Array.isArray(entry.value) ? entry.value.join('\n') : entry.value || ''
    box.addEventListener('input', () => {
      entry.value = box.value
      onChange()
    })
    return box
  }

  if (field.type === 'boolean') {
    const group = el('div', 'seg')
    for (const opt of [true, false]) {
      const btn = el('button', 'seg-btn', String(opt))
      btn.type = 'button'
      if (Boolean(entry.value) === opt) btn.classList.add('on')
      btn.addEventListener('click', () => {
        entry.value = opt
        for (const sibling of group.children) sibling.classList.remove('on')
        btn.classList.add('on')
        onChange()
      })
      group.append(btn)
    }
    return group
  }

  if (field.type === 'number' && field.choices) {
    const select = el('select', 'input')
    for (const choice of field.choices) {
      const option = el('option', null, choice.label)
      option.value = String(choice.value)
      select.append(option)
    }
    select.value = String(entry.value ?? field.default ?? '')
    select.addEventListener('change', () => {
      entry.value = select.value
      onChange()
    })
    return select
  }

  const input = el('input', 'input')
  input.type = field.type === 'number' ? 'number' : 'text'
  if (field.min !== undefined) input.min = String(field.min)
  if (field.max !== undefined) input.max = String(field.max)
  input.placeholder = field.placeholder || ''
  input.value = entry.value ?? ''
  input.addEventListener('input', () => {
    entry.value = input.value
    onChange()
  })
  return input
}

export function renderForm(container, endpoint, state, onChange) {
  container.textContent = ''

  for (const field of endpoint.fields) {
    const entry = state[field.name]
    const row = el('div', 'field')
    if (!field.required && !entry.enabled) row.classList.add('off')

    const head = el('div', 'field-head')

    if (field.required) {
      head.append(el('span', 'key mono', field.label))
      head.append(el('span', 'req', 'required'))
    } else {
      const toggle = el('label', 'toggle')
      const box = el('input')
      box.type = 'checkbox'
      box.checked = Boolean(entry.enabled)
      box.addEventListener('change', () => {
        entry.enabled = box.checked
        row.classList.toggle('off', !box.checked)
        onChange()
      })
      toggle.append(box, el('span', 'key mono', field.label))
      head.append(toggle)
      head.append(el('span', 'opt', entry.enabled ? 'sent' : 'not sent'))
    }

    row.append(head)
    row.append(renderControl(field, entry, onChange))
    if (field.hint) row.append(el('p', 'hint', field.hint))
    container.append(row)
  }
}

// Repaints the "sent / not sent" markers without rebuilding the form, so
// focus and caret position survive a keystroke.
export function refreshMarkers(container, endpoint, state) {
  const rows = container.querySelectorAll('.field')
  endpoint.fields.forEach((field, i) => {
    if (field.required) return
    const marker = rows[i] && rows[i].querySelector('.opt')
    if (marker) marker.textContent = state[field.name].enabled ? 'sent' : 'not sent'
  })
}
