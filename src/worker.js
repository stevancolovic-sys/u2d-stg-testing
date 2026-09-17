// Up2Data API Tester — Worker.
//
// Two jobs only: serve the static UI, and act as a sink for webhook
// callbacks. API traffic never passes through here — the browser talks to
// api.uptodata.io directly, so the API key and JWT stay client-side.

const TTL_SECONDS = 24 * 60 * 60

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

async function storeCallback(env, id, request) {
  const raw = await request.text()
  let body = null
  try {
    body = JSON.parse(raw)
  } catch {
    body = null
  }

  const key = `hook:${id}:${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const record = {
    id: key,
    receivedAt: new Date().toISOString(),
    headers: Object.fromEntries(request.headers),
    body,
    raw,
  }
  await env.HOOKS.put(key, JSON.stringify(record), { expirationTtl: TTL_SECONDS })
}

async function listCallbacks(env, id) {
  const { keys } = await env.HOOKS.list({ prefix: `hook:${id}:` })
  const events = await Promise.all(
    keys.map(async (k) => {
      const value = await env.HOOKS.get(k.name)
      return value ? JSON.parse(value) : null
    })
  )
  // Keys embed the timestamp, so a reverse sort is newest-first.
  return events.filter(Boolean).sort((a, b) => (a.id < b.id ? 1 : -1))
}

async function clearCallbacks(env, id) {
  const { keys } = await env.HOOKS.list({ prefix: `hook:${id}:` })
  await Promise.all(keys.map((k) => env.HOOKS.delete(k.name)))
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts[0] === 'hook' && parts[1]) {
      const id = parts[1]

      if (parts[2] === 'events' && request.method === 'GET') {
        return json({ events: await listCallbacks(env, id) })
      }
      if (!parts[2] && request.method === 'POST') {
        // Always answer 200, even if storage fails. A non-2xx puts the
        // delivery into the API's retry schedule (10min, 1h, 8h, 24h),
        // which is not what a dropped test callback deserves.
        try {
          await storeCallback(env, id, request)
        } catch (err) {
          console.error('hook store failed', err)
        }
        return json({ received: true })
      }
      if (!parts[2] && request.method === 'DELETE') {
        await clearCallbacks(env, id)
        return json({ cleared: true })
      }
      return json({ error: 'Not found' }, 404)
    }

    if (env.ASSETS) return env.ASSETS.fetch(request)
    return json({ error: 'Not found' }, 404)
  },
}
