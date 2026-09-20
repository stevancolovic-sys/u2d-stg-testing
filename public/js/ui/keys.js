// Where the API keys live: one per environment, saved against your account.

import { PRESETS } from '../config.js'
import { loadKeys, saveKey, forgetKey, clearToken, currentEnvironment } from '../keys.js'

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

export function mountKeys(container) {
  container.textContent = ''
  const rows = el('div', 'key-rows')
  container.append(rows)

  const draw = (keys) => {
    latest = keys
    announce(keys)
    rows.textContent = ''

    for (const preset of PRESETS) {
      const state = (keys && keys[preset.id]) || { set: false }
      const row = el('div', 'key-row')

      const head = el('div', 'key-head')
      head.append(el('span', 'key-env', preset.label))
      head.append(el('span', 'mono muted', preset.url))
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
            draw(await forgetKey(preset.id))
            clearToken(preset.id)
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
          const next = await saveKey(preset.id, value)
          input.value = ''
          clearToken(preset.id)
          note.textContent = 'Saved. The console will use it from now on.'
          setTimeout(() => (note.textContent = ''), 2500)
          draw(next)
        } catch (err) {
          note.textContent = String(err.message || err)
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
      rows.append(row)
    }

    container.append(
      el(
        'p',
        'hint',
        'Keys are held by this tool against your Google account, never in the browser, and are never shown again once saved. A key does not expire — the console asks for a fresh 24-hour token whenever it needs one, so you never sign in to the API by hand.'
      )
    )
  }

  loadKeys()
    .then(draw)
    .catch((err) => {
      rows.textContent = ''
      rows.append(el('p', 'hint', `Could not load your keys: ${err.message}`))
    })
}
