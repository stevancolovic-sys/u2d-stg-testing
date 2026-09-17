# Up2Data console

Internal tool for exercising the Up2Data API by hand: every endpoint, every
optional parameter behind a checkbox, a credit estimate before you send, and
webhook callbacks delivered into the page.

Runs as one Cloudflare Worker. The Worker serves the UI and receives webhook
callbacks — API calls go straight from your browser to `api.uptodata.io`, so
your API key and token never pass through Cloudflare.

## Run it locally

```bash
npm install
npm run dev      # http://localhost:8787
npm test
```

## Deploy

Nothing to create first — callbacks live in a SQLite-backed Durable Object,
which the deploy migration sets up. Two ways:

**From the Cloudflare dashboard.** Workers & Pages → Create → Import a
repository → pick this repo. Every push then deploys itself.

**From your terminal.**

```bash
npx wrangler login   # opens a browser
npm run deploy
```

## Using it

1. **Get a token.** Paste an API key (dashboard → Settings → Integrations →
   Create API Key) into the bar at the top. The token lasts 24 hours and the
   bar counts down. "Clear credentials" wipes the key and token from this
   browser.

2. **Pick an endpoint.** Required fields sit plain. Every optional field has
   a checkbox: unchecked means the key is left out of the request entirely,
   not sent as `null` or `false`. The Request tab shows the exact body.

3. **Watch the credit meter** above the send button. For the three search
   endpoints it turns red and asks for confirmation, because those reserve
   credits against each link's limit — and a link with no limit reserves the
   maximum (2,500 for people searches, 1,000 for company searches).

4. **Queues** appear in the Queues tab as you create them, polling their
   status until they complete, with paged results underneath.

5. **Callbacks** need one setup step. The Callbacks tab shows a URL; register
   it in the dashboard under Settings → Integrations → Create Webhook with a
   tag such as `test`. Then tick `webhookTags` on a request and enter that
   tag, and the results arrive in the tab.

   Anyone holding that URL can read what arrives at it, so send test data
   only and don't configure a real secret in the webhook's custom headers.

## What things cost

| Endpoint | Credits |
|---|---|
| `profiles-bulk` | 1 per profile, 2 with `withFollowersAndConnections` |
| `companies-bulk` | 1 per company |
| `activity` | 4 per profile |
| `posts` / `comments` / `reactions` | 2 per profile |
| `latest-post` | 5 per profile |
| `post-by-url` | 1 per post |
| `profile` (live) | 2, or 4 with `withFollowersAndConnections` |
| `company` (live) | 2 |
| `search` | limit × 3 per link; × 4 for people links with the followers flag |
| `partial-sales-profiles` / `partial-sales-companies` | limit × 1 per link |
| `status` / `list` / `authenticate` | free |

The meter shows an upper bound. The API de-duplicates input before charging,
and the search endpoints refund whatever they don't use.

## Layout

```
src/worker.js        routing, KV-backed callback store
public/index.html    shell
public/app.css       styling
public/js/
  endpoints.js       the 16 endpoints: fields and credit formulas
  request.js         builds the body — decides what is sent
  credits.js         credit estimate
  api.js             fetch wrapper
  app.js             wiring, auth, localStorage
  ui/form.js         form generation
  ui/response.js     status, headers, body
  ui/queues.js       status polling and result paging
  ui/webhooks.js     callback URL and live list
test/                request builder, credit formulas, worker routes
```

Adding an endpoint means adding one object to `public/js/endpoints.js`.

## Notes

- The API's own documentation transposes the curl examples for
  `/open-refresh/posts` and `/open-refresh/latest-post`. The registry follows
  the endpoint descriptions, not those examples.
- Callbacks are kept for 24 hours, and only the newest 200 per hook id.
