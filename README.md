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

## Who can get in

The console is behind Google sign-in and only a verified **@totema.co**
address passes. Sessions last 12 hours in a cookie that is `HttpOnly`,
`Secure`, `SameSite=Lax` and HMAC-signed, so editing its contents invalidates
it.

Three encrypted variables on the Worker turn it on:

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
SESSION_SECRET        any long random string
ALLOWED_DOMAIN        optional, defaults to totema.co
```

The OAuth client's authorised redirect URI must be exactly
`https://<worker>/auth/callback`.

Until all three are set the console is **closed**, not open: a gate nobody
configured must not look like a gate that passed.

**Webhook callbacks stay public, and must.** uptodata cannot sign in to
Google; a redirect instead of a 200 would push every delivery into its retry
schedule and then drop it after four attempts. So a `POST` outside `/auth` and
`/links` is always accepted as a callback, while every `GET` a person makes —
the page, `/links`, and reading callbacks back at `/hook/:id/events` — needs a
session. A test locks that split in place, including that callbacks still
arrive while sign-in is unconfigured.

Checking is done on the claims, not on the redirect: `email_verified` must be
true, the address must end in `@totema.co`, and where Google sends `hd` it
must agree. An address merely ending in the domain name, such as
`me@nottotema.co` or `me@totema.co.evil.com`, is refused.

## Using it

The console is organised around what people want, not around the sixteen
endpoints that answer it. Each job keeps the API's own names — People,
Companies, Activity, Post by URL, Search — and shows the endpoint it calls
next to them, so the two are plainly the same thing.

1. **Pick the API.** The `API` field at the top left is the base URL every
   request goes to. It starts on **staging**
   (`https://api.staging.uptodata.io/api`) so a stray click cannot spend
   production credits; the Production preset switches it. A token issued by
   one environment does not work against the other, so sign in again after
   switching.

2. **Sign in** with an API key from the dashboard (Settings → Integrations →
   Create API Key).

3. **Pick a job** on the left, then how you want it. The choice that matters
   is on the card: **Bulk** is cheapest and arrives as a job you watch,
   **Live** costs twice and answers in the same request. For Activity, tick
   which of posts, comments and reactions you want — all three cost what any
   two do.

4. **Paste who you want**, or take them from **Insert saved**.

5. **Options** holds everything the job does not ask up front —
   `withFollowersAndConnections`, `webhookTags`, `priority` and the rest, each
   behind its own checkbox. Unchecked means the key is left out of the request
   entirely, not sent as `null` or `false`; that difference costs credits and
   changes where callbacks go. **Show the exact request** prints what will be
   sent.

6. **Watch the credit line** above Send. The three search endpoints turn it
   red and ask for confirmation, because they hold credits against each link's
   limit — and a link with no limit holds the maximum.

7. **Results** arrive as a table with the columns people actually read, and
   leave as **CSV** or JSON. Bulk jobs appear under **Jobs**, polling until
   they finish and then showing their results without being asked.

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

## Saved links

A **Saved links** tab keeps the URLs you keep pasting, stored on the Worker so
the list is the same from any device. A link's type is worked out from the URL
when you save it:

| URL shape | type | fields that accept it |
|---|---|---|
| `linkedin.com/in/<slug>` | Profile | `profiles`, `profile` (live), burst targets |
| a bare URN id, `ACoAA…` | Profile | the same — the API takes these wherever a profile is expected |
| `linkedin.com/company/<slug>` | Company | `companies`, `company` (live) |
| `/sales/search/people` | Lead search | `search`, `partial-sales-profiles` |
| `/sales/search/company` | Account search | `search`, `partial-sales-companies` |
| `/feed/update/urn:…` or `/posts/<slug>` | Post | `post-by-url` |

The type is the point: every field that takes links has an **Insert saved**
button offering only the kind it accepts, so a company URL can never land in a
field expecting a profile. A bare slug carries nothing to detect, so saving
one asks you to pick the type.

**Copy all** puts every listed URL on the clipboard, one per line, and
**Download JSON** saves the same set as a file. Both act on what is on screen,
so picking a type chip or typing in the search narrows them — the button says
the count so a click holds no surprises. In a field's picker, **Select all**
ticks everything showing, which is how a whole list gets into a burst in one
go.

**Paste a list** takes a whole block at once, one per line or comma separated,
and reports what it recognised before saving. Give the batch shared tags, or
force a type when the values carry nothing to detect.

Saving the same link twice updates it rather than duplicating it — the key
ignores `www.`, the scheme, query strings and trailing slashes. URN ids are
the exception: they are case-sensitive, so they are compared exactly.

The store is shared and unauthenticated, like the callback sink: anyone with
the Worker URL can read and change it. Fine for LinkedIn URLs; do not keep
anything else there.

## Burst

The two live endpoints get a **Burst** tab: paste a few targets, say how many
requests and at what rate, and the console fires them and reports:

- **sent of N** — how many went out against how many were asked for
- **succeeded / did not** — a 404 counts as "did not": the request worked,
  the record does not exist
- **why the rest did not** — one line per reason in the API's own terms
  (rate limited, not enough credits, no worker free within 10s, token
  expired, never reached the API), biggest group first
- **per second** — requests completed across the run
- **average each**, and **p50 / p95**
- **waiting on server** vs **downloading** — `fetch` resolves when the
  response headers arrive, so this split separates the API doing the work
  from the bytes moving. A finer breakdown (DNS, TCP, time to first byte)
  would need a `Timing-Allow-Origin` header the API does not send.
- **response size**
- **all of them took** — wall clock from first request to last response
- **credits spent** — 200 and 404 only; a 429 is free
- when the first 429 arrived and what `Retry-After` asked for

**Pacing** has two shapes:

- **N per second** — requests leave on a schedule whether or not the earlier
  ones have answered. `0` sends everything at once, which is the hardest thing
  you can throw at the limiter.
- **N at a time** — at most N are ever in flight, and a new one starts when
  one finishes. At `1` the next request is sent only after the previous comes
  back, which is the honest measure of a single request: running several at
  once inflates each one. Measured against staging, a live `company` call
  averaged 3.1s one at a time and 8.7s at twelve concurrent.

**Give up after** N seconds abandons a request the way a client with a timeout
does, and the summary answers the question that setting exists to ask: **what
a client would have received** at 5, 10, 15, 20, 30 and 60 seconds, counted
from the measured times, so one run reads the whole curve.

Abandoning a request does not stop the API working on it and does not refund
the credit — it only stops you listening, so a timed-out request is counted as
billed. Thresholds above your own timeout are reported as floors: a request
you abandoned might have landed under a longer one, and there is no way to
know after leaving. Run with `0` (wait forever) to read every threshold
exactly.

The target list cycles, so five slugs can answer twenty requests; different
slugs matter, since repeating one can measure a cache rather than the work.

Credits are only spent on requests the API answers about a record (200 or
404). A 429 is free, so overshooting the limit is cheap — and the overshoot
is the measurement. The estimate above the button is the worst case.

The whole run downloads as JSON, one entry per request.

## Notes on the API as it behaves

- `/open-refresh/status` is documented as returning `"pending"` or
  `"completed"`. Staging also returns **`"notified"`** for a finished queue
  whose webhooks have gone out. The console therefore treats a queue as
  finished when `processed` reaches `total`, or when the status word is one of
  several known terminal values — the count is the signal that does not depend
  on guessing the vocabulary.
- The live endpoints are documented as sharing **10 requests per 10 seconds
  per team**. On staging, 12 concurrent live `company` requests all returned
  200 with no 429 and **no `RateLimit-*` header on any response**, though the
  API does list those headers in `access-control-expose-headers`. Latency
  under that concurrency ranged from 3.2s to 14.5s. Treat the documented limit
  as unverified on staging.
- Live request time is the API working, not the network. A live `company`
  call measured 2,739 ms total: 2,739 ms waiting for the response headers,
  0 ms downloading, 953 bytes of body. The wait is LinkedIn being scraped.
- A finished activity queue has been observed reporting `1/1` processed while
  `/open-refresh/list` returns `{"items":[],"total":0}`, with or without
  `failed=true`. When that happens the console says so instead of showing a
  bare `[]`. Take the results from the webhook callback in that case.

## Notes

- The API's own documentation transposes the curl examples for
  `/open-refresh/posts` and `/open-refresh/latest-post`. The registry follows
  the endpoint descriptions, not those examples.
- Callbacks are kept for 24 hours, and only the newest 200 per hook id.
- `wrangler.toml` sets `run_worker_first` on the assets config. Without it the
  asset layer answers before the Worker runs and replies 405 to a POST at `/`,
  because `index.html` lives there — a webhook pointed at the origin could
  never reach the sink, and every delivery would fail.
