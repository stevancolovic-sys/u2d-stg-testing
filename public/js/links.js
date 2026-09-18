// Saved links, and what each kind is good for.
//
// A link's type is not decoration: it decides which endpoints can accept it,
// so the console can offer only the right ones and never paste a company URL
// into a field expecting a profile.

export const TYPES = [
  {
    id: 'profile',
    label: 'Profile',
    // linkedin.com/in/<slug>, or a bare URN member id such as ACoAAA… which
    // the API accepts wherever a profile is expected. These are
    // case-sensitive, so the pattern is not anchored case-insensitively.
    match: /linkedin\.com\/in\/([^/?#]+)|^(AC[A-Za-z0-9_-]{28,60})$/,
    feeds: 'profiles, activity, latest post, live profile, burst',
  },
  {
    id: 'leadSearch',
    label: 'Lead search',
    // Checked before company: the path says sales, not company.
    match: /linkedin\.com\/sales\/search\/people/i,
    feeds: 'search, partial sales profiles',
  },
  {
    id: 'accountSearch',
    label: 'Account search',
    match: /linkedin\.com\/sales\/search\/company/i,
    feeds: 'search, partial sales companies',
  },
  {
    id: 'company',
    label: 'Company',
    match: /linkedin\.com\/company\/([^/?#]+)/i,
    feeds: 'companies, live company',
  },
  {
    id: 'post',
    label: 'Post',
    match: /linkedin\.com\/(?:feed\/update\/|posts\/)/i,
    feeds: 'post by url',
  },
]

export const typeById = (id) => TYPES.find((t) => t.id === id) || null

// Returns null when the string carries nothing to go on — a bare slug, say,
// which could be a profile or a company. The UI asks rather than guessing.
export function detectType(url) {
  const text = String(url || '').trim()
  if (!text) return null
  for (const type of TYPES) {
    if (type.match.test(text)) return type.id
  }
  return null
}

// The readable part of a link: the slug for a profile or company, the search
// name where there is one, otherwise a trimmed URL.
export function describe(url) {
  const text = String(url || '').trim()
  for (const type of TYPES) {
    const m = text.match(type.match)
    if (!m) continue
    const captured = m[1] || m[2]
    return captured ? decodeURIComponent(captured) : type.label
  }
  return text.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)
}

export function normaliseLink(input) {
  const url = String(input.url || '').trim()
  return {
    id: input.id,
    url,
    type: input.type || detectType(url),
    label: String(input.label || '').trim() || describe(url),
    tags: (Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(','))
      .map((t) => String(t).trim().toLowerCase())
      .filter(Boolean),
    createdAt: input.createdAt,
  }
}

// Same link saved twice is the same link, whatever the query string says.
export const dedupeKey = (url) => {
  const text = String(url || '').trim()
  // URN member ids are case-sensitive — ACoAA and acoaa are different people.
  if (/^AC[A-Za-z0-9_-]{28,60}$/.test(text)) return text
  return text
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
}

// A pasted block becomes one link per line, blanks and duplicates dropped,
// order kept.
export function splitPasted(text) {
  const seen = new Set()
  const out = []
  for (const raw of String(text || '').split(/[\n,]/)) {
    const value = raw.trim()
    if (!value) continue
    const key = dedupeKey(value)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

export function filterLinks(links, { type, query } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return links.filter((link) => {
    if (type && link.type !== type) return false
    if (!q) return true
    return (
      link.label.toLowerCase().includes(q) ||
      link.url.toLowerCase().includes(q) ||
      link.tags.some((t) => t.includes(q))
    )
  })
}
