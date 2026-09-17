// Turns an endpoint's credit formula into a sentence, by running the real
// formula rather than restating it. The reference and the console therefore
// cannot disagree about what something costs.

const UNIT = { profiles: 'profile', companies: 'company', posts: 'post URL' }
const COST_FLAGS = ['withFollowersAndConnections', 'withFullSkillsAndEndorsements']

const probe = (endpoint, state) => endpoint.credits(state)

// Cost sentences are derived by running the real credit formulas, so they
// cannot drift from what the console charges.
export function costLabel(endpoint) {
  if (!endpoint.credits) return 'Free.'

  const listField = endpoint.fields.find((f) => UNIT[f.name] && f.type === 'lines')
  const hasLinks = endpoint.fields.some((f) => f.type === 'links')
  const flags = endpoint.fields.filter((f) => COST_FLAGS.includes(f.name)).map((f) => f.name)

  if (hasLinks) {
    const one = { salesNavigatorLinks: { value: [{ url: 'https://www.linkedin.com/sales/search/people?query=a', limitEnabled: true, limit: 1 }] } }
    const base = probe(endpoint, one).amount
    const withFlag = flags.length
      ? probe(endpoint, { ...one, withFollowersAndConnections: { enabled: true, value: true } }).amount
      : base
    const parts = [
      `${base} credit${base === 1 ? '' : 's'} reserved per result, against each link's limit rather than the results delivered`,
    ]
    if (withFlag !== base) parts.push(`${withFlag} for people searches sent with withFollowersAndConnections`)
    parts.push('unused credits are refunded when the queue finishes')
    return parts.join('. ') + '.'
  }

  if (listField) {
    const unit = UNIT[listField.name]
    const one = { [listField.name]: { value: 'a' }, lists: { value: ['posts', 'comments', 'reactions'] } }
    const base = probe(endpoint, one).amount
    const bumped = flags.length
      ? probe(endpoint, { ...one, [flags[0]]: { enabled: true, value: true } }).amount
      : base
    let label = `${base} credit${base === 1 ? '' : 's'} per ${unit}`
    if (bumped !== base) {
      label += `, ${bumped} with ${flags.join(' or ')}`
      if (flags.length > 1) label += ' — enabling both does not stack'
    }
    return label + '.'
  }

  const single = { profile: { value: 'x' }, company: { value: 'x' } }
  const base = probe(endpoint, single).amount
  if (!base) return 'Free.'
  const bumped = flags.length
    ? probe(endpoint, { ...single, [flags[0]]: { enabled: true, value: true } }).amount
    : base
  let label = `${base} credit${base === 1 ? '' : 's'}`
  if (bumped !== base) {
    label += `, or ${bumped} with ${flags.join(' or ')}`
    if (flags.length > 1) label += ' — enabling both does not stack'
  }
  return label + ', charged whether the record is found (200) or not (404).'
}

