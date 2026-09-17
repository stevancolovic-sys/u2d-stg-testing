// Prose that the endpoint registry does not carry: the guides, and the
// caveats worth knowing per endpoint. Field lists and credit rules come from
// endpoints.js, so the two views can never disagree about those.

export const GUIDES = [
  {
    id: 'start',
    name: 'Start here',
    body: [
      { p: 'Two steps before anything else: create an API key in the dashboard under Settings → Integrations, then exchange it for a JWT at /api-auth/authenticate. That token goes in the Authorization header of every other request.' },
      { warn: 'The header carries the raw token. No Bearer prefix.' },
      { p: 'From there, endpoints fall into three kinds. Bulk endpoints enqueue many profiles or companies and answer with a queueId you poll or receive callbacks for. Live endpoints enrich one record and return it in the same response. Search endpoints start from a Sales Navigator URL instead of a list of links.' },
      { code: { label: 'Authenticate', text: `curl -X POST https://api.staging.uptodata.io/api/api-auth/authenticate \\
  -H "Content-Type: application/json" \\
  -d '{"apiKey": "your-api-key-here"}'

# {"accessToken": "eyJhbGciOiJIUzI1NiIs..."}` } },
    ],
  },
  {
    id: 'optional-fields',
    name: 'Optional fields',
    body: [
      { p: 'An optional field left out of the body is not the same as one sent with a falsy value, and the difference costs money or changes routing.' },
      { p: 'withFollowersAndConnections omitted means the cheaper rate. Sent as false also means the cheaper rate, but says so explicitly. webhookTags omitted broadcasts callbacks to every webhook on the team; sent as an empty array switches callbacks off entirely for that request. Those are three different requests, and only one of them is what you meant.' },
      { p: 'This is why the console puts a checkbox on every optional field and shows the exact body before you send it.' },
    ],
  },
  {
    id: 'credits',
    name: 'What things cost',
    body: [
      { p: 'Per-item endpoints charge for what survives normalisation: the list you send is de-duplicated and cleaned first, so you pay for enqueued, not for what you submitted. The response reports what was dropped under skipped.' },
      { p: 'Search endpoints work the other way round. Credits are reserved against each link’s limit at the moment you enqueue, not against the results delivered, and the unused part is refunded when the queue finishes. A link with no limit reserves the maximum for its type — 2,500 for a people search, 1,000 for a company search.' },
      { warn: 'Live endpoints charge on a 404 as well as a 200. A 400, 403, 429 or 503 charges nothing.' },
    ],
  },
  {
    id: 'webhooks',
    name: 'Webhooks',
    body: [
      { p: 'Configure them in the dashboard under Settings → Integrations. A webhook needs an HTTPS URL, and can carry custom headers for authenticating the callbacks it sends you, plus tags for routing.' },
      { p: 'Your endpoint must answer 2xx within 3 seconds. A failure is retried after 10 minutes, 1 hour, 8 hours and 24 hours, then abandoned — items whose delivery failed can be read back from /open-refresh/list with failed=true.' },
      { p: 'Tags decide where a request’s callbacks go. Name them in webhookTags and every webhook carrying any of those tags receives the results, which is how development, staging and production endpoints stay apart. A tag matching no webhook is rejected with a 400 and nothing is enqueued, so a typo can never leave you waiting for callbacks that were never coming.' },
      { p: 'Tags are lowercased and trimmed before matching, may hold letters, digits, dot, underscore and hyphen, and are capped at 32 characters. A request may name at most 10. They are resolved each time a callback is sent, so a webhook tagged later still receives results from a queue already running.' },
      { p: 'Every enqueue response echoes the webhooks your tags resolved to — the fastest way to confirm routing is wired correctly.' },
    ],
  },
]

// Notes shown under an endpoint, beyond the field table the registry gives.
export const NOTES = {
  authenticate: [
    { info: 'The token is valid for 24 hours. It carries an exp claim of iat + 86400.' },
  ],
  'profiles-bulk': [
    { info: 'Slugs are compared case-insensitively, but the value you sent is used as-is when crawling, so case-sensitive URN ids such as ACwAAD… still resolve.' },
    { info: 'Credits are charged at enqueue, so a profile whose follower counts turn out to be unavailable is still billed at the higher rate.' },
    { warn: 'If nothing survives normalisation you get a 400 and no queue is created.' },
  ],
  'companies-bulk': [
    { warn: 'If nothing survives normalisation you get a 400 and no queue is created.' },
  ],
  activity: [
    { info: 'partial tells you which of the three lists the last scrape could not read. A list flagged true was not refreshed: /open-refresh/list returns the values from its most recent successful scrape, while the callback carries it empty. Check the flags before reading an empty list as "this person has none".' },
    { info: 'scrapedAt always describes the latest scrape, so it can be newer than the contents of a flagged list.' },
  ],
  posts: [{ info: 'Callback type is "ActivityPosts", and result holds the profile plus a posts array.' }],
  comments: [{ info: 'Callback type is "ActivityComments", and result holds the profile plus a comments array.' }],
  reactions: [{ info: 'Callback type is "ActivityReactions", and result holds the profile plus a reactions array.' }],
  'latest-post': [
    { info: 'In a callback the post fields are nested under result.post rather than sitting on the record.' },
  ],
  'post-by-url': [
    { info: 'Both URL shapes work: /feed/update/urn:li:activity:<id> (raw or URL-encoded, and share and ugcPost URNs too) and /posts/<slug>. Query strings and trailing slashes are stripped for you.' },
    { info: 'De-duplication is on the post, not the string: the same post sent twice through two different URL shapes is charged once.' },
  ],
  profile: [
    { warn: 'Shares a limit of 10 requests per 10 seconds per team with the live company endpoint. Every response carries RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset; a 429 also carries Retry-After.' },
    { info: 'A 503 means no worker became available within 10 seconds or the crawl could not finish — retry later. It charges nothing.' },
    { info: 'The response is a Profile document with no wrapper and no _id.' },
  ],
  company: [
    { warn: 'Shares the 10-requests-per-10-seconds team limit with the live profile endpoint.' },
    { info: 'The response is a Company document with no wrapper and no _id.' },
  ],
  search: [
    { info: 'People searches (/sales/search/people) allow up to 2,500 results per link; company searches (/sales/search/company) up to 1,000. Omitting a limit uses — and reserves — the maximum.' },
    { info: 'Sales Navigator reports result counts in ranges: 1k+ can mean anything from 1,000 to 1,499.' },
  ],
  'partial-sales-profiles': [
    { info: 'Each link becomes its own queue, named after your name with "- 1", "- 2" appended, and every id comes back in queueIds in the order you sent the links.' },
    { warn: 'Every url must be a people search and must carry a query parameter, passed via either ? or #. A company search URL is rejected with a 400 and nothing is enqueued, even if the other links are valid.' },
    { info: 'A partial record has no experience history, education, skills or contact data.' },
  ],
  'partial-sales-companies': [
    { info: 'Each link becomes its own queue, as with partial-sales-profiles.' },
    { warn: 'Every url must be an account search carrying a query parameter. A people search URL is rejected with a 400.' },
  ],
  list: [
    { warn: 'queueId, page and limit are required on every call, and limit must be between 1 and 25.' },
    { info: 'The shape of each item is decided by the queue: an enrichment queue returns Profiles or Companies, a partial queue returns the lighter records, an activity queue returns Activity documents.' },
    { info: 'totalResults is what the Sales Navigator search itself reported, usually larger than total, and only present on search queues once their first page has been scraped.' },
  ],
  status: [{ info: 'status is "pending" until everything is processed, then "completed".' }],
}
