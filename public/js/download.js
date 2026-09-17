// Saving a response to disk. The console is served from its own origin, so a
// blob download works normally here.

const pad = (n) => String(n).padStart(2, '0')

// A local timestamp, safe in a filename — you want to know when you pulled
// something, in your own clock, without hunting through the JSON.
export function stamp(date = new Date()) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

export function jsonFilename(parts, date = new Date()) {
  const slug = (Array.isArray(parts) ? parts : [parts])
    .filter((p) => p !== undefined && p !== null && String(p).trim() !== '')
    .map((p) =>
      String(p)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    )
    .filter(Boolean)
    .join('-')
  return `${slug || 'response'}-${stamp(date)}.json`
}

export function downloadJson(data, parts) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = jsonFilename(parts)
  document.body.append(link)
  link.click()
  link.remove()
  // Revoke on the next tick — Safari needs the url to still resolve when the
  // click is handled.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function copyJson(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  await navigator.clipboard.writeText(text)
}
