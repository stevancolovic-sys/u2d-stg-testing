// What the Workers asset binding did: hand back a file from public/, and fall
// back to index.html so the console is reachable at its own address.

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

export function assets(root) {
  const serve = async (rel) => {
    // Never let a path climb out of public/.
    const target = path.join(root, path.normalize('/' + rel))
    if (!target.startsWith(path.resolve(root))) return null
    try {
      const info = await stat(target)
      if (info.isDirectory()) return null
      const body = await readFile(target)
      return new Response(body, {
        headers: {
          'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
          // The console is one page plus modules that change together; a
          // revalidate keeps a deploy from being served half old.
          'Cache-Control': 'public, max-age=0, must-revalidate',
        },
      })
    } catch {
      return null
    }
  }

  return {
    async fetch(request) {
      const { pathname } = new URL(request.url)
      const direct = await serve(pathname === '/' ? '/index.html' : pathname)
      if (direct) return direct
      const index = await serve('/index.html')
      return index || new Response('Not found', { status: 404 })
    },
  }
}
