import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
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
