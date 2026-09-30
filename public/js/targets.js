// Pools of things to call with.
//
// A load run that sends the same URL every time measures a cache, not the
// workers behind it. Each operation draws from a pool of its own kind and
// cycles, so a target does not repeat until the pool has been round once.

import { parseLines } from './request.js'

// Real companies with stable LinkedIn pages, so a run has somewhere to start
// without anyone pasting a list. Made-up targets would answer 422
// unprocessable_target — which still bills — so none are invented here.
export const COMPANY_SEED = [
  // Only slugs seen to answer 200 from the API. An unverified slug answers
  // 422 unprocessable_target, which bills and measures nothing — so a short
  // list that works beats a long one that does not.
  'stripe', 'figma', 'shopify', 'spotify', 'airbnb', 'uber', 'netflix',
  'twilio', 'atlassian', 'nvidia', 'sap', 'anthropicresearch', 'openai',
  'google', 'microsoft', 'amazon', 'meta',
].map((slug) => `https://www.linkedin.com/company/${slug}`)

// Which pool an operation draws from, and the field the target goes into.
// Search operations take no target: their variety comes from their filters.
export function targetSlotFor(endpoint) {
  const path = String(endpoint?.path || '')
  if (path.includes('/search/')) return null
  if (path.startsWith('/profiles/')) return { kind: 'profile', field: 'url' }
  if (path.startsWith('/companies/')) return { kind: 'company', field: 'url' }
  if (path.startsWith('/jobs/')) return { kind: 'job', field: 'url' }
  if (path.startsWith('/posts/')) {
    // Engagement is addressed by urn; enrich takes either, and url is kinder
    // to paste.
    return { kind: 'post', field: path.includes('/engagement/') ? 'urn' : 'url' }
  }
  return null
}

export const KINDS = ['profile', 'company', 'post', 'job']

export const kindLabel = {
  profile: 'Profiles',
  company: 'Companies',
  post: 'Posts',
  job: 'Jobs',
}

// A URN identifies a profile as well as a URL does, and the saved list is
// full of them.
export const asProfileTarget = (value) => String(value || '').trim()

export function buildPools({ saved = [], pasted = {} } = {}) {
  const profiles = saved
    .filter((l) => l.type === 'profile')
    .map((l) => asProfileTarget(l.url))
    .filter(Boolean)

  const pools = {
    profile: [...profiles, ...parseLines(pasted.profile)],
    company: [...parseLines(pasted.company)],
    post: parseLines(pasted.post),
    job: parseLines(pasted.job),
  }

  // Only fall back to the seed when nothing was supplied, so a pasted list is
  // never diluted by names nobody asked for.
  if (!pools.company.length) pools.company = [...COMPANY_SEED]

  for (const kind of KINDS) pools[kind] = [...new Set(pools[kind])]
  return pools
}

export function nextTarget(pool, index) {
  if (!pool || !pool.length) return null
  return pool[index % pool.length]
}

// What a run can actually send, given the pools it has. An operation whose
// pool is empty is reported rather than silently skipped.
export function runnable(endpoints, pools) {
  const ready = []
  const blocked = []
  for (const endpoint of endpoints) {
    const slot = targetSlotFor(endpoint)
    if (!slot) {
      ready.push(endpoint.id)
      continue
    }
    if ((pools[slot.kind] || []).length) ready.push(endpoint.id)
    else blocked.push({ id: endpoint.id, needs: slot.kind })
  }
  return { ready, blocked }
}
