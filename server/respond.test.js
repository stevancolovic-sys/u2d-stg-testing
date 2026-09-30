import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

import { send } from './respond.js'

const through = async (reply) => {
  const server = http.createServer((req, res) => send(res, reply))
  await new Promise((r) => server.listen(0, r))
  const got = await fetch(`http://localhost:${server.address().port}/`, { redirect: 'manual' })
  const body = await got.text()
  server.close()
  return { got, body }
}

test('keeps every cookie, not just the last one', async () => {
  const headers = new Headers({ location: '/' })
  headers.append('set-cookie', 'u2d_session=abc; Path=/; HttpOnly')
  headers.append('set-cookie', 'u2d_state=; Path=/; Max-Age=0')

  const { got } = await through(new Response(null, { status: 302, headers }))
  const cookies = got.headers.getSetCookie()

  assert.equal(cookies.length, 2)
  assert.ok(cookies.some((c) => c.startsWith('u2d_session=abc')), 'the session cookie survived')
  assert.ok(cookies.some((c) => c.startsWith('u2d_state=')), 'the state cookie survived')
  assert.equal(got.headers.get('location'), '/')
})

test('carries status and body through unchanged', async () => {
  const reply = new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  })
  const { got, body } = await through(reply)
  assert.equal(got.status, 201)
  assert.equal(body, '{"ok":true}')
})
