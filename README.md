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

1. **Pick the API.** The `API` field at the top left is the base URL every
   request goes to. It starts on **staging**
   (`https://api.staging.uptodata.io/api`) so a stray click cannot spend
   production credits; the Production preset switches it. The choice is
   remembered per browser, and a token issued by one environment does not
   work against the other, so authenticate again after switching.

2. **Get a token.** Paste an API key (dashboard → Settings → Integrations →
   Create API Key) into the bar at the top. The token lasts 24 hours and the
   bar counts down. "Clear credentials" wipes the key and token from this
   browser.

3. **Pick an endpoint.** Required fields sit plain. Every optional field has
   a checkbox: unchecked means the key is left out of the request entirely,
   not sent as `null` or `false`. The Request tab shows the exact body.

4. **Watch the credit meter** above the send button. For the three search
   endpoints it turns red and asks for confirmation, because those reserve
   credits against each link's limit — and a link with no limit reserves the
   maximum (2,500 for people searches, 1,000 for company searches).

5. **Queues** appear in the Queues tab as you create them, polling their
   status until they complete, with paged results underneath.

6. **Callbacks** need one setup step. The Callbacks tab shows a URL; register
   it in the dashboard under Settings → Integrations → Create Webhook with a
   tag such as `test`. Then tick `webhookTags` on a request and enter that
   tag, and the results arrive in the tab.

   Anyone holding that URL can read what arrives at it, so send test data
   only and don't configure a real secret in the webhook's custom headers.

## What things cost

| Endpoint | Credits |
|---|---|
| `profiles-bulk` | 1 per profile, 2 with `withFollowersAndConnections` or `withFullSkillsAndEndorsements` |
| `companies-bulk` | 1 per company |
| `activity`, all three lists | 4 per profile, one request |
| `activity`, one list | 2 per profile |
| `activity`, two lists | 4 per profile, two requests — same price as all three |
| `latest-post` | 5 per profile |
| `post-by-url` | 1 per post |
| `profile` (live) | 2, or 4 with either profile flag — the two do not stack |
| `company` (live) | 2 |
| `search` | limit × 3 per link; × 4 for people links with the followers flag |
| `partial-sales-profiles` / `partial-sales-companies` | limit × 1 per link |
| `status` / `list` / `authenticate` | free |

`withFullSkillsAndEndorsements` adds `skillsWithEndorsements` (every skill
with its endorsement count) and lifts the 20-skill cap on `skills`. The API
documents the exact surcharge only for the live endpoint — 2 credits becomes
4, and enabling both flags does not stack. For `profiles-bulk` it says only
"additional credits on top of the base rate", so the meter assumes the same
rule there: 1 becomes 2, and the two flags do not stack. Worth confirming
against a real bill before trusting it on a large batch.

The meter shows an upper bound. The API de-duplicates input before charging,
and the search endpoints refund whatever they don't use.

## The reference page

`up2data-docs.html` is a standalone reference for the API — open it by double
clicking, no server needed. Rebuild it after changing the registry:

```bash
npm run docs
```

It is generated from `public/js/endpoints.js`, so field lists and credit
figures come from the same code the console charges by and cannot drift.
Prose and response shapes live in `docs-src/`.

What it does that the official page does not: every endpoint is its own entry
with its own link (`#/endpoint/activity`), `/` focuses a search across
endpoints, fields, guides and schemas, response shapes are collapsible trees
rather than a wall of JSON, and each endpoint has an **Open in console**
button that opens it here with the form ready (`?endpoint=<id>`).

## Layout

```
src/worker.js        routing, KV-backed callback store
public/index.html    shell
public/app.css       styling
public/js/
  config.js          which API base URL requests go to
  activity.js        which activity lists to fetch, and the cheapest route
  endpoints.js       the 16 endpoints: fields and credit formulas
  request.js         builds the body — decides what is sent
  credits.js         credit estimate
  api.js             fetch wrapper
  app.js             wiring, auth, localStorage
  ui/form.js         form generation
  ui/response.js     status, headers, body
  ui/queues.js       status polling and result paging
  ui/webhooks.js     callback URL and live list
docs-src/            reference prose, response schemas, cost sentences
scripts/             build-docs.mjs → up2data-docs.html
test/                request builder, credit formulas, cost labels, worker routes
```

Adding an endpoint means adding one object to `public/js/endpoints.js`.

## Activity lists

`activity` is a picker rather than a single endpoint. Tick `posts`,
`comments` and `reactions` in any combination and the console sends the
cheapest requests that cover them:

- **one list** → one request to `/open-refresh/posts`, `/comments` or
  `/reactions`, 2 credits per profile
- **two lists** → two requests, 4 credits per profile
- **all three** → one request to `/open-refresh/activity`, 4 credits per
  profile — the bundle, rather than 6 for three separate calls

Two lists therefore cost exactly what three do, and the meter says so. It
still sends only what you ticked: the single-list endpoints answer with their
own callback `type` (`ActivityComments`, `ActivityReactions`) and their own
`partial` flags, which is usually the thing being tested.

## Notes

- The API's own documentation transposes the curl examples for
  `/open-refresh/posts` and `/open-refresh/latest-post`. The registry follows
  the endpoint descriptions, not those examples.
- Callbacks are kept for 24 hours, and only the newest 200 per hook id.
