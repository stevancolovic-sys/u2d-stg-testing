// Which API this console talks to. A staging tool that can only reach one
// host is not much of a staging tool, so the base URL is a setting: type any
// host, and the presets below are shortcuts for the ones used often.

const KEY = 'up2data.baseUrl'

export const PRESETS = [
  { id: 'production', label: 'Production', url: 'https://api.uptodata.io/api' },
]

export const DEFAULT_BASE = 'https://api.uptodata.io/api'

// Trailing slashes would double up against paths that already start with one.
export const normalizeBase = (url) => String(url ?? '').trim().replace(/\/+$/, '')

export function getBase() {
  try {
    return normalizeBase(localStorage.getItem(KEY)) || DEFAULT_BASE
  } catch {
    return DEFAULT_BASE
  }
}

export function setBase(url) {
  const next = normalizeBase(url) || DEFAULT_BASE
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* a browser refusing storage still gets a working session */
  }
  return next
}

export const presetFor = (url) => PRESETS.find((p) => p.url === normalizeBase(url)) || null
