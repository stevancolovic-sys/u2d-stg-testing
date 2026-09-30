// Where the API keys live: one per API and environment, saved against your
// account. Four slots in all — legacy and v1, staging and production.

import { PRESETS } from '../config.js'
import { APIS, loadKeys, saveKey, forgetKey, clearToken, currentEnvironment } from '../keys.js'

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const listeners = new Set()
export const onKeysChanged = (fn) => listeners.add(fn)
const announce = (keys) => listeners.forEach((fn) => fn(keys))

let latest = null
export const knownKeys = () => latest

// Each API answers on its own base, so a row has to name the one it will
// actually call — showing the legacy base under v1 was simply wrong.
const baseFor = (api, environment) =>
  (api.bases && api.bases[environment.id]) || environment.url

export function mountKeys(container) {
  container.textContent = ''
  const rows = el('div', 'key-rows')

  // Appended once. Building it inside draw() added another copy of this
  // paragraph every time a key was saved or removed.
  const footnote = el(
    'p',
    'hint',
    'Keys are held by this tool against your Google account, never in the browser, and are never shown again once saved. A key does not expire — the console asks for a fresh 24-hour token whenever it needs one, so you never sign in to the API by hand.'
  )
  container.append(rows, footnote)

  const drawRow = (api, preset, state, draw) => {
    const row = el('div', 'key-row')

    const head = el('div', 'key-head')
    head.append(el('span', 'key-env', preset.label))
    head.append(el('span', 'mono muted', baseFor(api, preset)))
    if (preset.id === currentEnvironment()) head.append(el('span', 'chip on', 'in use'))
    row.append(head)

    if (state.set) {
      const known = el('div', 'key-known')
      known.append(el('span', 'mono', state.hint))
      known.append(
        el('span', 'muted', state.savedAt ? `saved ${new Date(state.savedAt).toLocaleDateString()}` : '')
      )
      const forget = el('button', 'btn-ghost danger', 'Remove')
      forget.addEventListener('click', async () => {
        forget.disabled = true
        try {
          const next = await forgetKey(api.id, preset.id)
          clearToken(preset.id)
          draw(next)
        } finally {
          forget.disabled = false
        }
      })
      known.append(forget)
      row.append(known)
    }

    const entry = el('div', 'key-entry')
    const input = el('input', 'input')
    input.type = 'password'
    input.placeholder = state.set ? 'Replace the key' : 'Paste the API key'
    input.autocomplete = 'off'

    const save = el('button', 'btn', state.set ? 'Replace' : 'Save')
    const note = el('p', 'hint')

    const commit = async () => {
      const value = input.value.trim()
      if (!value) return
      save.disabled = true
      save.textContent = 'Saving…'
      try {
        const next = await saveKey(api.id, preset.id, value)
        input.value = ''
        clearToken(preset.id)
        draw(next)
      } catch (err) {
        note.textContent = String((err && err.message) || err)
        save.disabled = false
        save.textContent = state.set ? 'Replace' : 'Save'
      }
    }

    save.addEventListener('click', commit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit()
    })

    entry.append(input, save)
    row.append(entry, note)
    return row
  }

  const draw = (keys) => {
    latest = keys
    announce(keys)
    rows.textContent = ''

    for (const api of APIS) {
      rows.append(el('div', 'key-api', api.label))
      rows.append(el('p', 'hint', api.note))
      for (const preset of PRESETS) {
        const state = (keys && keys[api.id] && keys[api.id][preset.id]) || { set: false }
        rows.append(drawRow(api, preset, state, draw))
      }
    }
  }

  loadKeys()
    .then(draw)
    .catch((err) => {
      rows.textContent = ''
      rows.append(el('p', 'hint', `Could not load your keys: ${(err && err.message) || err}`))
    })
}
