import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // server/ is the Node adapter for running off Cloudflare. Its tests need
    // node:http, which this pool does not have; `npm run test:server` runs them.
    exclude: ['**/node_modules/**', 'server/**'],
    poolOptions: {
      workers: {
        // Isolated storage cannot roll back SQLite-backed Durable Objects, so
        // it is off and each test uses its own hook id instead.
        isolatedStorage: false,
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
})
