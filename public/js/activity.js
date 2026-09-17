// Picking which activity lists you want.
//
// The API has no endpoint for a subset: /activity returns all three lists for
// 4 credits, and /posts, /comments and /reactions each return one for 2. So
// the cheapest route depends on how many lists you asked for — and asking for
// two costs exactly what asking for three does.

export const ACTIVITY_LISTS = ['posts', 'comments', 'reactions']

const BUNDLE_RATE = 4
const SINGLE_RATE = 2

// Always in a fixed order, whatever order the boxes were ticked in.
export function normalizeSelection(selection) {
  const picked = new Set(selection || [])
  return ACTIVITY_LISTS.filter((list) => picked.has(list))
}

// Which endpoints to call. Three lists go as one /activity request; anything
// less goes to the single-list endpoints, one request each.
export function routeActivity(selection) {
  const picked = normalizeSelection(selection)
  if (!picked.length) return []
  if (picked.length === ACTIVITY_LISTS.length) return ['activity']
  return picked
}

export function activityCredits(selection, profileCount) {
  const picked = normalizeSelection(selection)
  const bundled = picked.length === ACTIVITY_LISTS.length

  if (!picked.length) {
    return { amount: 0, perProfile: 0, requests: 0, bundled: false, thirdIsFree: false }
  }

  const perProfile = bundled ? BUNDLE_RATE : picked.length * SINGLE_RATE
  return {
    amount: perProfile * profileCount,
    perProfile,
    requests: routeActivity(picked).length,
    bundled,
    // Two lists cost 4 per profile, and so do three. Worth saying out loud.
    thirdIsFree: picked.length === ACTIVITY_LISTS.length - 1,
  }
}
