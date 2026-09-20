// What people actually want, and which endpoints answer it.
//
// The API has sixteen endpoints; nobody arrives wanting endpoint number nine.
// They arrive wanting to know something about someone. A job names that want,
// and carries the choice that genuinely changes the answer — how soon, and how
// much of it — while everything else keeps a sensible default.

export const JOBS = [
  {
    id: 'people',
    title: 'People',
    blurb: 'Full profiles — headline, location, experience, education, skills.',
    question: 'Who do you want to know about?',
    targetLabel: 'One per line — LinkedIn URLs, slugs, or URN ids',
    placeholder: 'https://www.linkedin.com/in/johndoe\njanedoe\nACoAAAFQVg8Bl5-CNIAKaZpnJnNUZp6WQul09V0',
    linkTypes: ['profile'],
    modes: [
      {
        id: 'batch',
        label: 'Bulk',
        endpoint: 'profiles-bulk',
        blurb: 'Cheapest. Results arrive as a job you can watch.',
      },
      {
        id: 'now',
        label: 'Live',
        endpoint: 'profile',
        blurb: 'Twice the price, but the answer comes back in the same request.',
        oneAtATime: true,
      },
    ],
  },
  {
    id: 'companies',
    title: 'Companies',
    blurb: 'Company records — industry, size, location, funding where known.',
    question: 'Which companies?',
    targetLabel: 'One per line — LinkedIn company URLs or slugs',
    placeholder: 'https://www.linkedin.com/company/acme-corp\nglobex',
    linkTypes: ['company'],
    modes: [
      { id: 'batch', label: 'Bulk', endpoint: 'companies-bulk', blurb: 'Cheapest. Results arrive as a job you can watch.' },
      {
        id: 'now',
        label: 'Live',
        endpoint: 'company',
        blurb: 'Twice the price, answered in the same request.',
        oneAtATime: true,
      },
    ],
  },
  {
    id: 'activity',
    title: 'Activity',
    blurb: 'Posts published, comments left, posts reacted to.',
    question: 'Whose activity?',
    targetLabel: 'One per line — LinkedIn URLs, slugs, or URN ids',
    placeholder: 'https://www.linkedin.com/in/johndoe\njanedoe',
    linkTypes: ['profile'],
    modes: [
      {
        id: 'activity',
        label: 'Activity',
        endpoint: 'activity',
        blurb: 'Pick which lists you want. All three cost the same as any two.',
        lists: true,
      },
      {
        id: 'latest',
        label: 'Latest post',
        endpoint: 'latest-post',
        blurb: 'One item per person — what they did last.',
      },
    ],
  },
  {
    id: 'posts',
    title: 'Post by URL',
    blurb: 'Posts you already have links to, scraped from their permalinks.',
    question: 'Which posts?',
    targetLabel: 'One post URL per line',
    placeholder: 'https://www.linkedin.com/feed/update/urn:li:activity:7245678901234567890\nhttps://www.linkedin.com/posts/johndoe_hiring-activity-7245678901234567891-Ab1c',
    linkTypes: ['post'],
    modes: [{ id: 'byUrl', label: 'Post by URL', endpoint: 'post-by-url', blurb: '1 credit per post, whoever wrote it.' }],
  },
  {
    id: 'findPeople',
    title: 'Search — People',
    blurb: 'Start from a Sales Navigator lead search instead of a list of links.',
    question: 'Which search?',
    linkTypes: ['leadSearch'],
    links: true,
    modes: [
      {
        id: 'partial',
        label: 'Partial',
        endpoint: 'partial-sales-profiles',
        blurb: 'Name, region, current role. Cheapest way to size a search before committing.',
      },
      {
        id: 'full',
        label: 'Full search',
        endpoint: 'search',
        blurb: 'Full profiles, three times the price. Reserve carefully.',
      },
    ],
  },
  {
    id: 'findCompanies',
    title: 'Search — Companies',
    blurb: 'Start from a Sales Navigator account search.',
    question: 'Which search?',
    linkTypes: ['accountSearch'],
    links: true,
    modes: [
      {
        id: 'partial',
        label: 'Partial',
        endpoint: 'partial-sales-companies',
        blurb: 'Name, industry, size. Cheapest way to size a search.',
      },
      {
        id: 'full',
        label: 'Full search',
        endpoint: 'search',
        blurb: 'Full records, three times the price.',
      },
    ],
  },
]

export const jobById = (id) => JOBS.find((j) => j.id === id) || null

export function modeOf(job, modeId) {
  if (!job) return null
  return job.modes.find((m) => m.id === modeId) || job.modes[0]
}

// The field a job's targets go into, read from the endpoint rather than
// repeated here, so the two cannot disagree.
export function targetField(endpoint) {
  const preferred = ['profiles', 'companies', 'posts', 'salesNavigatorLinks']
  const byName = endpoint.fields.find((f) => preferred.includes(f.name))
  if (byName) return byName
  return endpoint.fields.find((f) => f.required && f.type === 'text') || null
}

// Everything a job does not ask about up front. Shown under Options, still
// with a checkbox each, because omitted and false are different requests.
export function optionalFields(endpoint) {
  return endpoint.fields.filter((f) => !f.required && !f.uiOnly)
}

// Required fields other than the one the job asks its question about — name
// and priority, mostly. They were rendered nowhere, so `name` went out empty
// and the API refused the queue.
export function otherRequiredFields(endpoint) {
  const target = targetField(endpoint)
  return endpoint.fields.filter((f) => f.required && !f.uiOnly && f !== target)
}

const isEmpty = (field, entry) => {
  const value = entry ? entry.value : undefined
  if (field.type === 'links') return !(value || []).some((row) => String(row.url || '').trim())
  if (Array.isArray(value)) return value.length === 0
  return String(value ?? '').trim() === ''
}

// What still has to be filled in before a request is worth sending. Checking
// here means the console never spends a round trip learning what it knew.
export function missingRequired(endpoint, state) {
  return endpoint.fields
    .filter((f) => f.required && !f.uiOnly && isEmpty(f, state[f.name]))
    .map((f) => f.name)
}

// A queue with no name is refused, and nobody wants to invent one. This is
// what the field starts as, and it stays editable.
// Written out rather than left to toLocaleDateString, whose month
// abbreviations differ between ICU builds — "20 Sep" in one browser and
// "20 Sept" in another is not a difference a queue name should carry.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function suggestedName(job, now = new Date()) {
  return `${job.title} — ${now.getDate()} ${MONTHS[now.getMonth()]}`
}
