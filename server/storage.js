// Durable Objects, on one machine.
//
// The Worker only ever reaches storage through `ctx.storage.sql.exec(...)`,
// and only ever reaches an object through `NAMESPACE.get(id).fetch(request)`.
// Reproduce those two shapes over SQLite and the store classes — HookStore,
// LinkStore, KeyStore — run unchanged. Nothing about the routing, the auth or
// the proxy had to be rewritten to move off Cloudflare.

import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// A Durable Object gets storage to itself, so each id gets its own file
// rather than a shared table anyone could read across accounts.
const fileFor = (dir, id) => {
  const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)
  const digest = createHash('sha256').update(String(id)).digest('hex').slice(0, 16)
  return path.join(dir, `${safe}.${digest}.sqlite`)
}

function sqlFor(db) {
  return {
    exec(sql, ...params) {
      const text = String(sql).trim()
      if (/^select/i.test(text)) {
        const rows = db.prepare(text).all(...params)
        return { toArray: () => rows }
      }
      // DDL takes no parameters and is happier going straight through.
      if (params.length === 0) db.exec(text)
      else db.prepare(text).run(...params)
      return { toArray: () => [] }
    },
  }
}

export function namespace(Store, dir) {
  mkdirSync(dir, { recursive: true })
  const live = new Map()
  return {
    idFromName: (name) => String(name),
    idFromString: (name) => String(name),
    get(id) {
      const key = String(id)
      let instance = live.get(key)
      if (!instance) {
        const db = new DatabaseSync(fileFor(dir, key))
        db.exec('PRAGMA journal_mode = WAL')
        instance = new Store({ storage: { sql: sqlFor(db) } })
        live.set(key, instance)
      }
      return instance
    },
  }
}
