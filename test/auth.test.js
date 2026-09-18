import { describe, it, expect } from 'vitest'
import {
  isAllowed, signSession, verifySession, parseCookies, cookie, clearCookie,
  decodeIdToken, authUrl, SESSION_COOKIE,
} from '../src/auth.js'

const SECRET = 'a-long-enough-secret-for-testing'
const soon = () => Math.floor(Date.now() / 1000) + 600

describe('isAllowed', () => {
  const ok = { email: 'stevan@totema.co', email_verified: true, hd: 'totema.co' }

  it('lets in a verified address on the domain', () => {
    expect(isAllowed(ok, 'totema.co')).toBe(true)
  })

  it('ignores case in the address and the domain', () => {
    expect(isAllowed({ ...ok, email: 'Stevan@Totema.CO', hd: 'Totema.co' }, 'TOTEMA.co')).toBe(true)
  })

  it('refuses another domain', () => {
    expect(isAllowed({ ...ok, email: 'someone@example.com', hd: 'example.com' }, 'totema.co')).toBe(false)
  })

  it('refuses an unverified address, whatever it claims to be', () => {
    expect(isAllowed({ ...ok, email_verified: false }, 'totema.co')).toBe(false)
    expect(isAllowed({ email: 'stevan@totema.co' }, 'totema.co')).toBe(false)
  })

  it('refuses an address that merely ends in the domain name', () => {
    expect(isAllowed({ ...ok, email: 'me@nottotema.co', hd: undefined }, 'totema.co')).toBe(false)
    expect(isAllowed({ ...ok, email: 'me@totema.co.evil.com', hd: undefined }, 'totema.co')).toBe(false)
  })

  it('refuses when hd disagrees with the address', () => {
    expect(isAllowed({ ...ok, hd: 'elsewhere.com' }, 'totema.co')).toBe(false)
  })

  it('accepts a verified address with no hd, which a non-Workspace account lacks', () => {
    expect(isAllowed({ email: 'stevan@totema.co', email_verified: true }, 'totema.co')).toBe(true)
  })

  it('refuses nothing at all', () => {
    expect(isAllowed(null, 'totema.co')).toBe(false)
    expect(isAllowed({}, 'totema.co')).toBe(false)
    expect(isAllowed({ email: 'a@b.co', email_verified: true }, '')).toBe(false)
  })

  it('tolerates the domain being written with a leading @', () => {
    expect(isAllowed(ok, '@totema.co')).toBe(true)
  })
})

describe('sessions', () => {
  it('round-trips a payload', async () => {
    const token = await signSession({ email: 'stevan@totema.co', exp: soon() }, SECRET)
    expect((await verifySession(token, SECRET)).email).toBe('stevan@totema.co')
  })

  it('refuses a payload edited after signing', async () => {
    const token = await signSession({ email: 'stevan@totema.co', exp: soon() }, SECRET)
    const [, signature] = token.split('.')
    const forged = btoa(JSON.stringify({ email: 'intruder@evil.com', exp: soon() }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await verifySession(`${forged}.${signature}`, SECRET)).toBe(null)
  })

  it('refuses a signature made with another secret', async () => {
    const token = await signSession({ email: 'a@totema.co', exp: soon() }, 'another-secret-entirely')
    expect(await verifySession(token, SECRET)).toBe(null)
  })

  it('refuses an expired session', async () => {
    const token = await signSession({ email: 'a@totema.co', exp: Math.floor(Date.now() / 1000) - 1 }, SECRET)
    expect(await verifySession(token, SECRET)).toBe(null)
  })

  it('refuses a session with no expiry at all', async () => {
    const token = await signSession({ email: 'a@totema.co' }, SECRET)
    expect(await verifySession(token, SECRET)).toBe(null)
  })

  it('refuses rubbish without throwing', async () => {
    for (const bad of ['', 'nonsense', 'a.b', null, undefined, 'only-one-part']) {
      expect(await verifySession(bad, SECRET)).toBe(null)
    }
  })

  it('refuses everything when no secret is configured', async () => {
    const token = await signSession({ email: 'a@totema.co', exp: soon() }, SECRET)
    expect(await verifySession(token, '')).toBe(null)
  })
})

describe('cookies', () => {
  it('reads a cookie header', () => {
    expect(parseCookies('a=1; b=two%20words')).toEqual({ a: '1', b: 'two words' })
    expect(parseCookies('')).toEqual({})
    expect(parseCookies(null)).toEqual({})
  })

  it('writes one a script cannot read and a third party cannot send', () => {
    const header = cookie(SESSION_COOKIE, 'value')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Secure')
    expect(header).toContain('SameSite=Lax')
  })

  it('clears by expiring immediately', () => {
    expect(clearCookie(SESSION_COOKIE)).toContain('Max-Age=0')
  })
})

describe('decodeIdToken', () => {
  it('reads the claims out of the middle segment', () => {
    const payload = btoa(JSON.stringify({ email: 'a@totema.co' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodeIdToken(`header.${payload}.signature`).email).toBe('a@totema.co')
  })

  it('returns null for anything that is not a token', () => {
    expect(decodeIdToken('')).toBe(null)
    expect(decodeIdToken('one-part')).toBe(null)
    expect(decodeIdToken('a.!!!.c')).toBe(null)
  })
})

describe('authUrl', () => {
  it('asks only for identity, and carries the state', () => {
    const url = new URL(authUrl({ clientId: 'cid', redirectUri: 'https://x/cb', state: 's1', domain: 'totema.co' }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe('openid email')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('s1')
    expect(url.searchParams.get('hd')).toBe('totema.co')
    expect(url.searchParams.get('redirect_uri')).toBe('https://x/cb')
  })
})
