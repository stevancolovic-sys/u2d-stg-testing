import { describe, it, expect } from 'vitest'
import { detectType, describe as describeLink, normaliseLink, dedupeKey, filterLinks, splitPasted, typeById, TYPES } from '../public/js/links.js'

describe('detectType', () => {
  it('knows a profile', () => {
    expect(detectType('https://www.linkedin.com/in/johndoe')).toBe('profile')
    expect(detectType('https://linkedin.com/in/jane-doe-123/')).toBe('profile')
  })

  it('knows a company', () => {
    expect(detectType('https://www.linkedin.com/company/acme-corp')).toBe('company')
  })

  it('does not mistake a sales account search for a company page', () => {
    expect(detectType('https://www.linkedin.com/sales/search/company?query=abc')).toBe('accountSearch')
  })

  it('knows a lead search', () => {
    expect(detectType('https://www.linkedin.com/sales/search/people?query=abc')).toBe('leadSearch')
  })

  it('knows both post url shapes', () => {
    expect(detectType('https://www.linkedin.com/feed/update/urn:li:activity:7245678901234567890')).toBe('post')
    expect(detectType('https://www.linkedin.com/posts/johndoe_hiring-activity-72456789-Ab1c')).toBe('post')
  })

  it('knows a bare URN member id is a profile', () => {
    expect(detectType('ACoAAAFQVg8Bl5-CNIAKaZpnJnNUZp6WQul09V0')).toBe('profile')
    expect(detectType('ACoAAAHoDUoBw5ydmxJ98GFJ__pc6ZiXcJ-mlk')).toBe('profile')
    expect(detectType('ACwAADabcdefghijklmnopqrstuvwxyz12345')).toBe('profile')
  })

  it('does not mistake a short word for a URN', () => {
    expect(detectType('ACoAA')).toBe(null)
    expect(detectType('ACCOUNTING')).toBe(null)
  })

  it('returns null for a bare slug, which could be anything', () => {
    expect(detectType('johndoe')).toBe(null)
    expect(detectType('')).toBe(null)
    expect(detectType(null)).toBe(null)
  })

  it('every type declares what it feeds', () => {
    for (const t of TYPES) {
      expect(t.feeds, t.id).toBeTruthy()
      expect(typeById(t.id).label, t.id).toBe(t.label)
    }
  })
})

describe('describe', () => {
  it('pulls the slug out of a profile or company url', () => {
    expect(describeLink('https://www.linkedin.com/in/johndoe')).toBe('johndoe')
    expect(describeLink('https://www.linkedin.com/company/acme-corp?trk=x')).toBe('acme-corp')
  })

  it('names a search by its kind', () => {
    expect(describeLink('https://www.linkedin.com/sales/search/people?query=abc')).toBe('Lead search')
  })

  it('shows a URN id as itself', () => {
    const urn = 'ACoAAAFQVg8Bl5-CNIAKaZpnJnNUZp6WQul09V0'
    expect(describeLink(urn)).toBe(urn)
  })

  it('falls back to a trimmed url', () => {
    expect(describeLink('https://www.example.com/somewhere')).toBe('example.com/somewhere')
  })
})

describe('normaliseLink', () => {
  it('fills in the type and label when not given', () => {
    const link = normaliseLink({ url: ' https://www.linkedin.com/in/johndoe ' })
    expect(link.url).toBe('https://www.linkedin.com/in/johndoe')
    expect(link.type).toBe('profile')
    expect(link.label).toBe('johndoe')
  })

  it('keeps a label and type the user chose', () => {
    const link = normaliseLink({ url: 'johndoe', type: 'profile', label: 'Our champion' })
    expect(link.type).toBe('profile')
    expect(link.label).toBe('Our champion')
  })

  it('takes tags as a list or a comma string, lowercased', () => {
    expect(normaliseLink({ url: 'x', tags: ' Q1 , Fintech ' }).tags).toEqual(['q1', 'fintech'])
    expect(normaliseLink({ url: 'x', tags: ['A', ''] }).tags).toEqual(['a'])
  })
})

describe('dedupeKey', () => {
  it('treats the same link as the same whatever the decoration', () => {
    const a = dedupeKey('https://www.linkedin.com/in/johndoe/')
    expect(dedupeKey('http://linkedin.com/in/JohnDoe?trk=abc')).toBe(a)
  })

  it('keeps different links apart', () => {
    expect(dedupeKey('https://www.linkedin.com/in/a')).not.toBe(dedupeKey('https://www.linkedin.com/in/b'))
  })
})

describe('dedupeKey with URN ids', () => {
  it('keeps a URN exactly as sent — the id is case-sensitive', () => {
    const urn = 'ACoAAAFQVg8Bl5-CNIAKaZpnJnNUZp6WQul09V0'
    expect(dedupeKey(urn)).toBe(urn)
    expect(dedupeKey(urn)).not.toBe(dedupeKey(urn.toLowerCase()))
  })
})

describe('splitPasted', () => {
  it('takes one per line and drops blanks', () => {
    expect(splitPasted('a\n\n b \nc\n')).toEqual(['a', 'b', 'c'])
  })

  it('splits on commas too', () => {
    expect(splitPasted('a, b,c')).toEqual(['a', 'b', 'c'])
  })

  it('drops duplicates while keeping order', () => {
    expect(splitPasted('https://www.linkedin.com/in/a\nhttps://linkedin.com/in/a/?trk=x\nb')).toEqual([
      'https://www.linkedin.com/in/a',
      'b',
    ])
  })

  it('keeps two URNs that differ only in case', () => {
    const a = 'ACoAAAFQVg8Bl5-CNIAKaZpnJnNUZp6WQul09V0'
    expect(splitPasted(`${a}\n${a.toLowerCase()}`).length).toBe(2)
  })

  it('handles an empty paste', () => {
    expect(splitPasted('')).toEqual([])
    expect(splitPasted(null)).toEqual([])
  })
})

describe('filterLinks', () => {
  const links = [
    normaliseLink({ url: 'https://www.linkedin.com/in/johndoe', tags: ['q1'] }),
    normaliseLink({ url: 'https://www.linkedin.com/company/acme-corp', label: 'Acme' }),
    normaliseLink({ url: 'https://www.linkedin.com/sales/search/people?query=x', label: 'Fintech leads' }),
  ]

  it('filters by type', () => {
    expect(filterLinks(links, { type: 'profile' }).length).toBe(1)
    expect(filterLinks(links, { type: 'leadSearch' })[0].label).toBe('Fintech leads')
  })

  it('searches label, url and tags', () => {
    expect(filterLinks(links, { query: 'acme' }).length).toBe(1)
    expect(filterLinks(links, { query: 'q1' }).length).toBe(1)
    expect(filterLinks(links, { query: 'linkedin.com' }).length).toBe(3)
  })

  it('returns everything with no filter', () => {
    expect(filterLinks(links).length).toBe(3)
  })
})
