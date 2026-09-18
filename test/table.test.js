import { describe, it, expect } from 'vitest'
import { flatten, toRows, columnsFor, csvCell, toCsv } from '../public/js/table.js'

describe('flatten', () => {
  it('keeps scalars and dots nested objects', () => {
    expect(flatten({ a: 1, b: { c: 'x', d: true } })).toEqual({ a: 1, 'b.c': 'x', 'b.d': true })
  })

  it('joins an array of scalars and counts it', () => {
    expect(flatten({ skills: ['a', 'b'] })).toEqual({ skills: 'a · b', 'skills.count': 2 })
  })

  it('takes the first entry of an array of objects, plus a count', () => {
    const out = flatten({ experience: [{ title: 'VP', companyName: 'Acme' }, { title: 'Dev' }] })
    expect(out['experience.0.title']).toBe('VP')
    expect(out['experience.0.companyName']).toBe('Acme')
    expect(out['experience.count']).toBe(2)
  })

  it('keeps null rather than dropping the column', () => {
    expect(flatten({ end: null })).toEqual({ end: null })
  })

  it('stops before it recurses forever', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'too far' } } } } } }
    expect(JSON.stringify(flatten(deep))).not.toContain('too far')
  })

  it('survives an empty record', () => {
    expect(flatten({})).toEqual({})
    expect(flatten(null)).toEqual({})
  })
})

describe('columnsFor', () => {
  it('puts the columns a person looks for first', () => {
    const rows = toRows([
      { zzz: 1, headline: 'VP', firstName: 'John', lastName: 'Doe' },
    ])
    expect(columnsFor(rows).slice(0, 3)).toEqual(['firstName', 'lastName', 'headline'])
  })

  it('orders the rest by how many records carry them', () => {
    const rows = [{ rare: 1, common: 1 }, { common: 1 }, { common: 1 }]
    expect(columnsFor(rows)).toEqual(['common', 'rare'])
  })

  it('caps how many columns a table shows', () => {
    const wide = [Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]))]
    expect(columnsFor(wide, 5).length).toBe(5)
  })

  it('handles no rows', () => {
    expect(columnsFor([])).toEqual([])
  })
})

describe('csvCell', () => {
  it('quotes a value containing a comma, quote or newline', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
  })

  it('leaves a plain value alone', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell(42)).toBe('42')
    expect(csvCell(false)).toBe('false')
  })

  it('renders nothing for null or undefined', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('defuses a value a spreadsheet would run as a formula', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)")
    expect(csvCell('+1 555 0100')).toBe("'+1 555 0100")
    expect(csvCell('-3')).toBe("'-3")
    expect(csvCell('@handle')).toBe("'@handle")
  })

  it('quotes and defuses together when both apply', () => {
    expect(csvCell('=A1,B1')).toBe(`"'=A1,B1"`)
  })
})

describe('toCsv', () => {
  it('writes a header and one line per row, CRLF separated', () => {
    const csv = toCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y' }], ['a', 'b'])
    expect(csv).toBe('a,b\r\n1,x\r\n2,y')
  })

  it('leaves a gap where a row lacks a column', () => {
    expect(toCsv([{ a: 1 }], ['a', 'b'])).toBe('a,b\r\n1,')
  })

  it('works out its own columns when not told', () => {
    expect(toCsv(toRows([{ firstName: 'John' }]))).toBe('firstName\r\nJohn')
  })

  it('writes just a header for no rows', () => {
    expect(toCsv([], ['a'])).toBe('a')
  })
})
