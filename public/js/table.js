// Turning enriched records into something you can read and open in a
// spreadsheet. A Profile has twenty-nine fields, most of them nested; nobody
// reads that as JSON to find out where someone works.

// Columns worth showing first, when a record has them. Everything else follows
// in the order it was found.
const PREFERRED = [
  'firstName', 'lastName', 'fullName', 'name', 'companyName',
  'headline', 'summary', 'location', 'geoRegion',
  'industry', 'numberOfEmployees', 'employeeCountRange', 'website',
  'url', 'fullUrl', 'linkedinSlug', 'linkedinId',
  'connectionsCount', 'followersCount', 'openToWork', 'isPremium',
  'experience.0.title', 'experience.0.companyName',
  'currentPositions.0.title', 'currentPositions.0.companyName',
  'scrapedAt', 'updatedAt',
]

const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)

// Nested objects become dotted paths. Arrays of objects contribute their first
// entry plus a count, because a column per array element is not a table.
export function flatten(value, prefix = '', out = {}, depth = 0) {
  if (depth > 3) return out

  for (const [key, inner] of Object.entries(value || {})) {
    const path = prefix ? `${prefix}.${key}` : key

    if (isScalar(inner)) {
      out[path] = inner
    } else if (Array.isArray(inner)) {
      out[`${path}.count`] = inner.length
      if (inner.length && isScalar(inner[0])) {
        out[path] = inner.filter(isScalar).join(' · ')
      } else if (inner.length) {
        flatten(inner[0], `${path}.0`, out, depth + 1)
      }
    } else if (inner && typeof inner === 'object') {
      flatten(inner, path, out, depth + 1)
    }
  }
  return out
}

export function toRows(items) {
  return (items || []).map((item) => flatten(item))
}

// Columns present in the data, preferred ones first, then the rest by how
// often they appear — a field two records in fifty carry is not a column.
export function columnsFor(rows, limit = 14) {
  const counts = new Map()
  for (const row of rows) {
    for (const key of Object.keys(row)) counts.set(key, (counts.get(key) || 0) + 1)
  }

  const preferred = PREFERRED.filter((key) => counts.has(key))
  const rest = [...counts.entries()]
    .filter(([key]) => !preferred.includes(key))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key)

  return [...preferred, ...rest].slice(0, limit)
}

// A leading =, +, - or @ makes a spreadsheet treat text as a formula, so it is
// prefixed with a quote. Everything else follows RFC 4180.
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(rows, columns) {
  const cols = columns && columns.length ? columns : columnsFor(rows)
  const lines = [cols.map(csvCell).join(',')]
  for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(','))
  return lines.join('\r\n')
}
