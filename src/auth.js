// Google sign-in for the console.
//
// The identity token is fetched from Google's token endpoint over TLS in the
// code exchange, so its signature needs no separate check — nothing else could
// have produced that response. What does need checking is who it says you are,
// and that the session cookie we hand back cannot be written by anyone else.

export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'

export const SESSION_COOKIE = 'u2d_session'
export const STATE_COOKIE = 'u2d_state'
export const SESSION_SECONDS = 12 * 60 * 60

const encoder = new TextEncoder()

const toBase64Url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const fromBase64Url = (text) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

const keyFor = (secret) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])

// --- the domain policy ---------------------------------------------------

// The whole point of the gate. A token is only good enough if Google says the
// address is verified and it belongs to the domain — an unverified address can
// be anything its owner typed.
export function isAllowed(claims, domain) {
  if (!claims || !domain) return false
  if (claims.email_verified !== true && claims.email_verified !== 'true') return false

  const email = String(claims.email || '').toLowerCase()
  const wanted = String(domain).toLowerCase().replace(/^@/, '')
  if (!email.endsWith(`@${wanted}`)) return false

  // Workspace accounts also carry hd. When present it must agree; when absent
  // the verified address is what we have.
  if (claims.hd && String(claims.hd).toLowerCase() !== wanted) return false

  return true
}

// --- sessions ------------------------------------------------------------

export async function signSession(payload, secret) {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(body))
  return `${body}.${toBase64Url(signature)}`
}

export async function verifySession(token, secret, now = Date.now()) {
  if (!token || !secret) return null
  const [body, signature] = String(token).split('.')
  if (!body || !signature) return null

  let ok = false
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      await keyFor(secret),
      fromBase64Url(signature),
      encoder.encode(body)
    )
  } catch {
    return null
  }
  if (!ok) return null

  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)))
  } catch {
    return null
  }

  if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null
  return payload
}

// --- odds and ends -------------------------------------------------------

export function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=')
    if (at < 1) continue
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim())
  }
  return out
}

export const cookie = (name, value, { maxAge = SESSION_SECONDS, path = '/' } = {}) =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`

export const clearCookie = (name) =>
  `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

// The identity token's payload. Its signature is not checked here because it
// arrived directly from Google's token endpoint — see the note at the top.
export function decodeIdToken(idToken) {
  const part = String(idToken || '').split('.')[1]
  if (!part) return null
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(part)))
  } catch {
    return null
  }
}

export const randomToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(24)))

export function authUrl({ clientId, redirectUri, state, domain }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  })
  // A hint to the account chooser, never a substitute for checking the claims.
  if (domain) params.set('hd', domain)
  return `${GOOGLE_AUTH}?${params}`
}
