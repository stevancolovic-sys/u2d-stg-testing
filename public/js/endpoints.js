// Declarative registry of every Up2Data endpoint.
//
// Everything the UI draws — the form, the request preview, the credit line —
// is generated from this array. Adding an endpoint means adding one object.

import { parseLines } from './request.js'
import { ACTIVITY_LISTS, routeActivity, activityCredits } from './activity.js'

const PEOPLE_MAX = 2500
const COMPANY_MAX = 1000

const count = (state, field) => parseLines(state[field]?.value).length

const flagOn = (state, name = 'withFollowersAndConnections') => {
  const entry = state[name]
  return Boolean(entry && entry.enabled && entry.value)
}

// Two flags, one surcharge: the docs are explicit for the live endpoint that
// enabling both does not stack, so either one lifts the rate and neither
// lifts it twice.
const costFlagOn = (state) =>
  flagOn(state, 'withFollowersAndConnections') || flagOn(state, 'withFullSkillsAndEndorsements')

// rate: credits per profile. flagRate: the rate when withFollowersAndConnections
// is checked AND true — an unchecked box means the key is not sent, so the
// cheaper rate applies.
const perItem = (listField, rate, flagRate = null) => (state) => {
  const n = count(state, listField)
  const each = flagRate && costFlagOn(state) ? flagRate : rate
  return { amount: n * each, reserved: false, note: `${n} × ${each}` }
}

const isPeopleSearch = (url) => String(url || '').includes('/sales/search/people')

const linkLimit = (row) => {
  const set = row.limitEnabled && row.limit !== '' && row.limit !== undefined && row.limit !== null
  if (set) return Number(row.limit)
  return isPeopleSearch(row.url) ? PEOPLE_MAX : COMPANY_MAX
}

// Search credits are RESERVED against each link's limit, not against the
// results actually delivered. An unchecked limit reserves the maximum — the
// single most expensive mistake this tool can make, so it is flagged.
const searchCredits = (baseRate, allowFlag) => (state) => {
  const rows = state.salesNavigatorLinks?.value || []
  const flag = allowFlag && flagOn(state)
  let impliedMax = false
  const amount = rows.reduce((sum, row) => {
    if (!(row.limitEnabled && row.limit)) impliedMax = true
    const rate = flag && isPeopleSearch(row.url) ? baseRate + 1 : baseRate
    return sum + linkLimit(row) * rate
  }, 0)
  return {
    amount,
    reserved: true,
    note: impliedMax
      ? 'a link with no limit reserves the maximum; unused credits are refunded'
      : 'reserved against each link limit; unused credits are refunded',
  }
}

// --- shared field definitions -------------------------------------------

const f = {
  name: (required) => ({
    name: 'name',
    label: 'name',
    type: 'text',
    required,
    placeholder: 'Q1 Leads Enrichment',
    hint: 'Label for the queue, shown in the dashboard.',
  }),
  priority: (required) => ({
    name: 'priority',
    label: 'priority',
    type: 'number',
    required,
    choices: [
      { value: 1, label: '1 — High' },
      { value: 2, label: '2 — Normal' },
      { value: 3, label: '3 — Low' },
    ],
    default: 2,
    hint: required ? '' : 'Defaults to 2 (Normal) when not sent.',
  }),
  profiles: {
    name: 'profiles',
    label: 'profiles',
    type: 'lines',
    required: true,
    linkTypes: ['profile'],
    placeholder: 'https://www.linkedin.com/in/johndoe\njanedoe',
    hint: 'One profile URL or LinkedIn slug per line.',
  },
  companies: {
    name: 'companies',
    label: 'companies',
    type: 'lines',
    required: true,
    linkTypes: ['company'],
    placeholder: 'https://www.linkedin.com/company/acme-corp\nglobex',
    hint: 'One company URL or LinkedIn slug per line.',
  },
  postUrls: {
    name: 'posts',
    label: 'posts',
    type: 'lines',
    required: true,
    linkTypes: ['post'],
    placeholder: 'https://www.linkedin.com/feed/update/urn:li:activity:7245678901234567890',
    hint: 'One post URL per line. Both /feed/update/urn:li:… and /posts/<slug> shapes work.',
  },
  withFollowers: {
    name: 'withFollowersAndConnections',
    label: 'withFollowersAndConnections',
    type: 'boolean',
    required: false,
    default: true,
    hint: 'Also collects connectionsCount and followersCount. Doubles the cost, charged at enqueue even if the counts turn out to be unavailable.',
  },
  withFullSkills: {
    name: 'withFullSkillsAndEndorsements',
    label: 'withFullSkillsAndEndorsements',
    type: 'boolean',
    required: false,
    default: true,
    hint: 'Adds skillsWithEndorsements — every skill paired with its endorsement count — and lifts the 20-skill cap on skills. Same surcharge as withFollowersAndConnections, and enabling both does not stack.',
  },
  webhookTags: {
    name: 'webhookTags',
    label: 'webhookTags',
    type: 'tags',
    required: false,
    hint: 'Unchecked: callbacks go to EVERY webhook on the team. Checked and empty: callbacks are switched off for this request. A tag matching no webhook is a 400 and nothing is enqueued.',
  },
  links: (max, linkTypes = ['leadSearch', 'accountSearch']) => ({
    name: 'salesNavigatorLinks',
    label: 'salesNavigatorLinks',
    type: 'links',
    required: true,
    max,
    linkTypes,
    hint: `Each row is one search URL. Per-link limit is optional — unchecked reserves the maximum (${max}).`,
  }),
}

export const ENDPOINTS = [
  {
    id: 'authenticate',
    group: 'Auth',
    label: 'authenticate',
    method: 'POST',
    path: '/api-auth/authenticate',
    auth: false,
    summary: 'Exchange an API key for a JWT valid for 24 hours.',
    fields: [
      {
        name: 'apiKey',
        label: 'apiKey',
        type: 'text',
        required: true,
        placeholder: 'your-api-key-here',
        hint: 'From the dashboard: Settings → Integrations → Create API Key.',
      },
    ],
    credits: null,
  },

  {
    id: 'profiles-bulk',
    group: 'Bulk enrichment',
    label: 'profiles-bulk',
    method: 'POST',
    path: '/open-refresh/profiles-bulk',
    auth: true,
    summary: 'Enqueue LinkedIn profiles for enrichment in bulk.',
    fields: [f.name(true), f.profiles, f.priority(true), f.withFollowers, f.withFullSkills, f.webhookTags],
    credits: perItem('profiles', 1, 2),
  },
  {
    id: 'companies-bulk',
    group: 'Bulk enrichment',
    label: 'companies-bulk',
    method: 'POST',
    path: '/open-refresh/companies-bulk',
    auth: true,
    summary: 'Enqueue LinkedIn companies for enrichment in bulk.',
    fields: [f.name(true), f.companies, f.priority(true), f.webhookTags],
    credits: perItem('companies', 1),
  },

  {
    id: 'activity',
    group: 'Activity',
    label: 'activity',
    method: 'POST',
    path: '/open-refresh/activity',
    auth: true,
    summary: 'Pick the lists you want. One request per list, or a single bundled request when you want all three.',
    // Which endpoints a send actually hits, decided by the list picker.
    route: (state) => routeActivity(state.lists?.value),
    fields: [
      f.profiles,
      {
        name: 'lists',
        label: 'lists',
        type: 'lists',
        required: true,
        uiOnly: true,
        options: ACTIVITY_LISTS,
        default: [...ACTIVITY_LISTS],
        hint: 'Each list costs 2 credits per profile on its own. All three bundle into one /activity request at 4, so two lists cost exactly what three do.',
      },
      f.name(false),
      f.priority(false),
      f.webhookTags,
    ],
    credits: (state) => {
      const n = count(state, 'profiles')
      const c = activityCredits(state.lists?.value, n)
      if (!c.requests) return { amount: 0, reserved: false, note: 'pick at least one list' }
      const plural = c.requests === 1 ? 'request' : 'requests'
      const note = `${n} × ${c.perProfile} · ${c.requests} ${plural}` +
        (c.thirdIsFree ? ' · the third list costs nothing extra at this price' : '') +
        (c.bundled ? ' · bundled as /activity, 4 instead of 6' : '')
      return { amount: c.amount, reserved: false, note }
    },
  },
  {
    id: 'posts',
    hidden: true,
    group: 'Activity',
    label: 'posts',
    method: 'POST',
    path: '/open-refresh/posts',
    auth: true,
    summary: 'Only the posts each profile published.',
    fields: [f.profiles, f.name(false), f.priority(false), f.webhookTags],
    credits: perItem('profiles', 2),
  },
  {
    id: 'comments',
    hidden: true,
    group: 'Activity',
    label: 'comments',
    method: 'POST',
    path: '/open-refresh/comments',
    auth: true,
    summary: 'Only the comments each profile left.',
    fields: [f.profiles, f.name(false), f.priority(false), f.webhookTags],
    credits: perItem('profiles', 2),
  },
  {
    id: 'reactions',
    hidden: true,
    group: 'Activity',
    label: 'reactions',
    method: 'POST',
    path: '/open-refresh/reactions',
    auth: true,
    summary: 'Only the posts each profile reacted to.',
    fields: [f.profiles, f.name(false), f.priority(false), f.webhookTags],
    credits: perItem('profiles', 2),
  },

  {
    id: 'latest-post',
    group: 'Posts',
    label: 'latest-post',
    method: 'POST',
    path: '/open-refresh/latest-post',
    auth: true,
    summary: 'The single most recent item per profile.',
    fields: [f.profiles, f.name(false), f.priority(false), f.webhookTags],
    credits: perItem('profiles', 5),
  },
  {
    id: 'post-by-url',
    group: 'Posts',
    label: 'post-by-url',
    method: 'POST',
    path: '/open-refresh/post-by-url',
    auth: true,
    summary: 'Scrape individual posts from their own permalinks.',
    fields: [f.postUrls, f.name(false), f.priority(false), f.webhookTags],
    credits: perItem('posts', 1),
  },

  {
    id: 'profile',
    group: 'Live',
    label: 'profile (live)',
    method: 'POST',
    path: '/open-refresh/profile',
    auth: true,
    live: true,
    summary: 'One profile, enriched now, returned in the response. No queue.',
    fields: [
      {
        name: 'profile',
        label: 'profile',
        type: 'text',
        required: true,
        placeholder: 'https://www.linkedin.com/in/johndoe',
        linkTypes: ['profile'],
        hint: 'A linkedin.com/in/ URL or a bare slug.',
      },
      f.withFollowers,
      f.withFullSkills,
    ],
    credits: (state) => ({
      amount: costFlagOn(state) ? 4 : 2,
      reserved: false,
      note: 'charged on a 200 and on a 404 alike; enabling both flags does not stack',
    }),
  },
  {
    id: 'company',
    group: 'Live',
    label: 'company (live)',
    method: 'POST',
    path: '/open-refresh/company',
    auth: true,
    live: true,
    summary: 'One company, enriched now, returned in the response. No queue.',
    fields: [
      {
        name: 'company',
        label: 'company',
        type: 'text',
        required: true,
        placeholder: 'https://www.linkedin.com/company/acme-corp',
        linkTypes: ['company'],
        hint: 'A linkedin.com/company/ URL or a bare slug.',
      },
    ],
    credits: () => ({ amount: 2, reserved: false, note: 'charged on a 200 and on a 404 alike' }),
  },

  {
    id: 'search',
    group: 'Search',
    label: 'search',
    method: 'POST',
    path: '/open-refresh/search',
    auth: true,
    summary: 'Full enrichment from Sales Navigator search URLs, at 3× the base rate.',
    fields: [
      f.name(true),
      f.links(2500),
      f.priority(true),
      { ...f.withFollowers, hint: 'Lead searches only — ignored on /sales/search/company links. Raises those links to 4 credits per result.' },
      f.webhookTags,
    ],
    credits: searchCredits(3, true),
  },
  {
    id: 'partial-sales-profiles',
    group: 'Search',
    label: 'partial-sales-profiles',
    method: 'POST',
    path: '/open-refresh/partial-sales-profiles',
    auth: true,
    summary: 'Lighter lead records at the base rate. One queue per link.',
    fields: [f.name(true), f.priority(true), f.links(2500, ['leadSearch']), f.webhookTags],
    credits: searchCredits(1, false),
  },
  {
    id: 'partial-sales-companies',
    group: 'Search',
    label: 'partial-sales-companies',
    method: 'POST',
    path: '/open-refresh/partial-sales-companies',
    auth: true,
    summary: 'Lighter account records at the base rate. One queue per link.',
    fields: [f.name(true), f.priority(true), f.links(1000, ['accountSearch']), f.webhookTags],
    credits: searchCredits(1, false),
  },

  {
    id: 'status',
    group: 'Queues',
    label: 'status',
    method: 'GET',
    path: '/open-refresh/status',
    auth: true,
    summary: 'How many items of a queue have been processed.',
    fields: [
      { name: 'queueId', label: 'queueId', type: 'text', required: true, placeholder: '507f1f77bcf86cd799439011' },
    ],
    credits: null,
  },
  {
    id: 'list',
    group: 'Queues',
    label: 'list',
    method: 'GET',
    path: '/open-refresh/list',
    auth: true,
    summary: 'The enriched results of a queue, paginated.',
    fields: [
      { name: 'queueId', label: 'queueId', type: 'text', required: true, placeholder: '507f1f77bcf86cd799439011' },
      { name: 'page', label: 'page', type: 'number', required: true, default: 0, min: 0, hint: '0-indexed.' },
      { name: 'limit', label: 'limit', type: 'number', required: true, default: 10, min: 1, max: 25, hint: 'Must be between 1 and 25.' },
      { name: 'failed', label: 'failed', type: 'boolean', required: false, default: true, hint: 'Returns items whose webhook delivery failed.' },
    ],
    credits: null,
  },
]

export const byId = (id) => ENDPOINTS.find((e) => e.id === id)

// What the rail lists. The single-list activity endpoints are reachable
// through the activity picker rather than on their own.
export const VISIBLE = ENDPOINTS.filter((e) => !e.hidden)
