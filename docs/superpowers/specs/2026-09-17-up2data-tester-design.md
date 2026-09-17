# Up2Data API Tester — Design

**Date:** 2026-09-17
**Status:** Approved design, pending implementation plan

## Purpose

An internal tool for exercising every endpoint of the Up2Data API
(`https://api.uptodata.io/api`) by hand. It exists so that a developer can
see what a request looks like before sending it, send it, watch the queue it
creates, and read the webhook callbacks it produces — without writing curl
commands or a throwaway script for each experiment.

Two requirements drove the design:

1. **Every optional parameter must be visible**, each behind a checkbox, so
   that the difference between "not sent" and "sent as false" is a deliberate
   choice rather than an accident.
2. **Webhook callbacks must arrive in the tool itself**, not in a second
   browser tab on a third-party site.

## Hosting

A single Cloudflare Worker on the free plan, served from a `*.workers.dev`
subdomain.

Two alternatives were rejected:

- **Claude Artifact.** Artifacts run under a CSP that blocks `fetch` to every
  external host, and no runtime capability grants arbitrary network access.
  A page published this way could not call the API at all.
- **GitHub Pages.** Static hosting serves the UI fine — the API sends
  `access-control-allow-origin` reflecting any origin and allows the
  `authorization` header, verified on 2026-09-17 — but it cannot receive a
  webhook POST. Reading callbacks back from `webhook.site` is also impossible:
  its API returns no CORS headers, so the browser blocks the read.

The Worker solves both: it serves the page and it owns an HTTPS endpoint that
can accept POSTs.

## Architecture

```
Browser (the tool)                 Cloudflare Worker            Up2Data API
-----------------                  -----------------            -----------
GET  /                       -->   serves index.html
POST /open-refresh/...       ------------------------------->   (direct, CORS)
GET  /open-refresh/status    ------------------------------->   (direct, CORS)
                                   POST /hook/:id          <--  webhook callback
GET  /hook/:id/events        -->   reads KV
```

**API traffic never passes through the Worker.** The API key and the JWT stay
in the browser, and requests go straight to `api.uptodata.io`. The Worker is
only a static host plus a callback sink. This keeps credentials out of
Cloudflare's logs and keeps the Worker free of any auth handling.

### Worker routes

| Route | Method | Behaviour |
|---|---|---|
| `/` | GET | Serves the UI as a single HTML document. |
| `/hook/:id` | POST | Accepts a webhook callback. Stores the body, headers and receipt time in KV under `hook:<id>:<timestamp>-<rand>` with a 24-hour TTL. Always answers `200` within the API's 3-second budget. |
| `/hook/:id/events` | GET | Returns the stored callbacks for `<id>`, newest first, as JSON. Same-origin, so no CORS concerns. |
| `/hook/:id` | DELETE | Clears the stored callbacks for `<id>`. |

`:id` is a random 16-character identifier the UI generates and keeps in
`localStorage`, so one person's callbacks are not visible in another person's
tool unless they share the id. This is obscurity, not access control — see
Security below.

**Storage:** one SQLite-backed Durable Object per hook id, available on the
Workers free plan. A Durable Object is created by the deploy migration rather
than provisioned ahead of time, so deploying — by CLI or by importing the
repository in the Cloudflare dashboard — needs no resource set up by hand and
no ids pasted into config. Reads are strongly consistent, unlike KV.

Each hook keeps callbacks for 24 hours and at most the newest 200; both are
enforced on write. Callbacks are ephemeral test data, so this is a feature.

### UI structure

No framework and no bundler: the browser loads the source files as written.
`npm` is used only for `wrangler` and the test runner, never to build the app.
Three files, served by the Worker:

- `src/index.html` — layout and shell
- `src/app.js` — endpoint registry, form generation, request builder, queue
  tracker, webhook panel
- `src/app.css` — styling

The endpoint registry is the heart of the tool: a declarative array where each
entry describes one endpoint's method, path, auth requirement, credit formula,
and field list. Every other part of the UI — the form, the request preview,
the credit estimate — is generated from that array. Adding a new endpoint when
the API grows means adding one object, not touching the rendering code.

## Components

### 1. Auth panel

Takes an API key, calls `POST /api-auth/authenticate`, stores the returned
`accessToken` in `localStorage` alongside the time it was issued, and shows a
countdown to the 24-hour expiry. The API key is also stored so the token can
be refreshed with one click. A visible "Clear credentials" button wipes both.

The `Authorization` header carries the raw token with no `Bearer` prefix, as
the API documents.

### 2. Endpoint list and form

The left pane lists all sixteen endpoints, grouped:

- **Auth** — `authenticate`
- **Bulk enrichment** — `profiles-bulk`, `companies-bulk`
- **Activity** — `activity`, `posts`, `comments`, `reactions`
- **Posts** — `latest-post`, `post-by-url`
- **Live** — `profile`, `company`
- **Search** — `search`, `partial-sales-profiles`, `partial-sales-companies`
- **Queues** — `status`, `list`

Selecting one renders its form on the right.

**Required fields** are always present and marked.

**Optional fields each carry a checkbox.** Unchecked means the key is omitted
from the request body entirely — not sent as `null`, not sent as `false`. This
is the tool's central behaviour and the reason it exists: the API's defaults
differ from explicit values in ways that cost credits (`withFollowersAndConnections`)
or change routing (`webhookTags`, where an omitted key broadcasts to every
webhook on the team and `[]` suppresses callbacks entirely).

Field types rendered: text, textarea (one item per line, for `profiles`,
`companies`, `posts`), number, boolean checkbox, string-array (tag input, for
`webhookTags`), and a repeating row editor for `salesNavigatorLinks` where
each row has a `url` and an optional `limit`.

### 3. Request preview

A live, read-only JSON view of the exact body about to be sent, updating on
every keystroke and checkbox toggle, plus the resolved method, URL and
headers. For GET endpoints it shows the assembled query string. A "Copy as
curl" button emits an equivalent command.

This is what makes the checkbox behaviour legible: toggling
`withFollowersAndConnections` visibly adds or removes the key.

### 4. Credit estimator

Each endpoint declares a credit formula evaluated against the current form
state, displayed above the send button.

| Endpoint | Cost |
|---|---|
| `profiles-bulk` | 1 per profile, 2 with `withFollowersAndConnections` |
| `companies-bulk` | 1 per company |
| `activity` | 4 per profile |
| `posts`, `comments`, `reactions` | 2 per profile |
| `latest-post` | 5 per profile |
| `post-by-url` | 1 per post URL |
| `profile` (live) | 2, or 4 with `withFollowersAndConnections` |
| `company` (live) | 2 |
| `search` | `limit × 3` per link; `limit × 4` for people links with `withFollowersAndConnections`; company links stay at ×3 |
| `partial-sales-profiles` | `limit × 1` per link, defaulting to 2500 when `limit` is unchecked |
| `partial-sales-companies` | `limit × 1` per link, defaulting to 1000 when `limit` is unchecked |
| `status`, `list`, `authenticate` | free |

The estimate is an upper bound computed from what is typed, and the UI says
so: the API de-duplicates and normalises input before charging, and search
endpoints refund unused reservations. For the three search endpoints — the
only ones that can reserve thousands of credits from a single click — sending
requires confirming a dialog that states the reserved amount.

The dialog also fires when an unchecked `limit` means the maximum is being
reserved implicitly, since that is the specific mistake it exists to prevent.

### 5. Response viewer

Shows HTTP status, elapsed time, pretty-printed JSON body, and response
headers. For the two live endpoints it surfaces `RateLimit-Limit`,
`RateLimit-Remaining`, `RateLimit-Reset` and, on a 429, `Retry-After`
prominently, because those endpoints share a 10-requests-per-10-seconds team
limit.

Validation errors (400) from the search endpoints arrive as an `errors` array
rather than a `message` string; the viewer renders both shapes readably.

### 6. Queue tracker

Every response carrying `queueId` or `queueIds` appends entries to a queue
list held in `localStorage`, each recording its id, the endpoint that created
it, the name sent, and the creation time.

Polling of `GET /open-refresh/status` starts automatically for a queue the
tool just created, showing `processed / total` as a progress bar, and stops on
its own once `status` becomes `completed`. It does **not** resume by itself
when the page is reloaded — queues restored from `localStorage` show a "Resume
polling" button instead, so reopening the tool never silently starts a dozen
polling loops. Every queue can be started and stopped by hand at any time.

Results come from `GET /open-refresh/list` with paging controls. `limit` is
constrained to 1–25 in the UI because the API rejects anything outside that
range, and `page` is 0-indexed. The `failed` checkbox retrieves items whose
webhook delivery failed. When a response carries `totalResults`, it is shown
next to `total` with a note that it is what the Sales Navigator search
reported rather than what the queue scraped.

Results render as raw JSON, with a flattened table view for the common fields
of whichever record type came back.

### 7. Webhook panel

On first use the UI generates a random hook id and shows the full callback
URL. The workflow, stated in the panel itself:

1. Copy the URL.
2. In the Up2Data dashboard, Settings → Integrations → Create Webhook, paste
   it and give the webhook a tag (for example `test`).
3. Back in the tool, check `webhookTags` on any request and enter that tag.

The panel then polls `/hook/:id/events` every few seconds while it is open and
lists arriving callbacks with their `type`, `queueId`, `name`, `url` and the
full `result` object, expandable. A counter shows how many have arrived; a
clear button empties the store.

Every enqueue response echoes a `webhooks` array naming the endpoints the tags
resolved to. The tool surfaces this prominently, because it is the immediate
confirmation that routing is wired correctly — and a tag matching no webhook
is a 400 that enqueues nothing.

## Data flow

1. User enters an API key → token in `localStorage`.
2. User picks an endpoint, fills the form, toggles optional fields.
3. Request preview updates live from form state.
4. Send → `fetch` direct to `api.uptodata.io` with the token header.
5. Response rendered; any `queueId` captured into the queue tracker.
6. User starts polling `/status`, then reads `/list`.
7. In parallel, callbacks land on `/hook/:id` and appear in the webhook panel.

## Error handling

- **No token, or expired token.** Endpoints requiring auth are disabled with
  an explanation rather than allowed to fail with a 401.
- **Network or CORS failure.** `fetch` rejections are caught and shown as a
  transport error distinct from an HTTP error status, since the two have very
  different causes.
- **Non-JSON response body.** Displayed as raw text rather than crashing the
  viewer on a parse error.
- **429 on a live endpoint.** Surfaces `Retry-After` and disables the send
  button for that many seconds.
- **Worker KV unavailable.** The webhook panel shows the failure and keeps the
  rest of the tool working; webhooks are an optional part of the workflow.
- **Callback body that is not valid JSON.** Stored and displayed as raw text;
  the Worker never rejects a callback for being unparseable, because
  rejecting it would trigger the API's retry schedule.

## Testing

The tool is a manual instrument, so the automated tests cover the parts where
a silent mistake would be invisible or expensive:

1. **Request builder.** Given a form state, the built body contains exactly
   the checked optional keys and omits the unchecked ones. This is the
   tool's core promise; it gets the most coverage, including the cases where
   an unchecked boolean must not appear as `false` and `webhookTags: []` must
   survive as an empty array rather than being dropped as empty.
2. **Credit estimator.** Each formula against representative inputs,
   especially the search endpoints where an unchecked `limit` implies the
   maximum.
3. **Worker routes.** `POST /hook/:id` stores and answers 200 for JSON and
   non-JSON bodies alike; `GET /hook/:id/events` returns newest-first;
   `DELETE` clears; an unknown path 404s.

Tests run under `vitest` with `@cloudflare/vitest-pool-workers` for the Worker
routes, which runs them in the real workerd runtime against a local KV.

Manual verification before deploy, via `wrangler dev`: authenticate with a
real key, send one live `POST /open-refresh/company` (2 credits) to confirm
the auth header and response viewer work end to end, and POST a handcrafted
callback to the local `/hook/:id` to confirm it appears in the panel.

## Security

The Worker is public and unauthenticated by design — it must be, because the
API has to reach `/hook/:id` without credentials.

- **Credentials never reach the Worker.** The API key and JWT live only in
  `localStorage` and travel only to `api.uptodata.io`.
- **Hook ids are unguessable, not secret.** Anyone holding an id can read
  those callbacks. The tool is for test data, and the panel says so plainly.
  Webhook custom headers configured in the dashboard are stored alongside the
  callback body, so a shared secret set there would be visible to anyone with
  the id — the panel warns against configuring real production secrets on a
  webhook pointed at this tool.
- **`localStorage` on a shared machine** persists the API key until cleared;
  the "Clear credentials" button is always visible.
- **Callback rendering.** Callback bodies are third-party input and are
  written into the DOM with `textContent`, never `innerHTML`.

## Out of scope

- Creating or managing webhooks through the API — the dashboard is the only
  place that does this, and the API exposes no endpoint for it.
- Persisting request history to a server. Everything stays in `localStorage`.
- Multi-user accounts, teams, or sharing. One person, one browser.
- Retrying or replaying failed webhook deliveries.

## Known documentation discrepancy

In the API documentation, the curl examples for `POST /open-refresh/posts` and
`POST /open-refresh/latest-post` are transposed — each shows the other's URL.
The endpoint registry follows the endpoint headings and prose descriptions,
not the examples. Worth confirming against the live API during manual
verification.
