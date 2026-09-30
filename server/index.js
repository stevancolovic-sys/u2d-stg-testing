// The console, served from a plain Node process.
//
// src/worker.js is written against the web platform — Request in, Response
// out — so it is the same file here as on Cloudflare. This translates Node's
// http types at the edges and supplies the bindings it expects.

import './request-compat.js'

import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import worker, { HookStore, LinkStore, KeyStore } from '../src/worker.js'
import { namespace } from './storage.js'
import { assets } from './assets.js'
import { send } from './respond.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.join(here, '..', '.data')
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(here, '..', 'public')
const PORT = Number(process.env.PORT || 3000)

const env = {
  ...process.env,
  HOOKS: namespace(HookStore, path.join(DATA_DIR, 'hooks')),
  LINKS: namespace(LinkStore, path.join(DATA_DIR, 'links')),
  KEYS: namespace(KeyStore, path.join(DATA_DIR, 'keys')),
  ASSETS: assets(PUBLIC_DIR),
}

// Behind Caddy the socket says http://u2d:3000, but the OAuth redirect_uri is
// built from the request's own origin and has to match what Google lists. The
// proxy tells us what the browser actually asked for.
function externalUrl(req) {
  const headers = req.headers
  const proto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http'
  const host = String(headers['x-forwarded-host'] || headers.host || 'localhost').split(',')[0].trim()
  return new URL(req.url, `${proto}://${host}`)
}

async function toRequest(req) {
  const url = externalUrl(req)
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one)
  }

  let body
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    body = Buffer.concat(chunks)
    if (body.length === 0) body = undefined
  }

  return new Request(url, { method: req.method, headers, body })
}

const server = http.createServer(async (req, res) => {
  try {
    const reply = await worker.fetch(await toRequest(req), env)
    await send(res, reply)
  } catch (err) {
    // The same contract the Worker keeps: a failure says what it was.
    console.error('[u2d]', req.method, req.url, err)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(
      JSON.stringify({
        error: 'The console hit an internal error.',
        detail: String((err && err.message) || err),
        where: req.url,
      })
    )
  }
})

server.listen(PORT, () => console.log(`[u2d] listening on ${PORT}, data in ${DATA_DIR}`))
