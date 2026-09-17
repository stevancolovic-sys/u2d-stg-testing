import { describe, it, expect } from 'vitest'
import { jsonFilename, stamp } from '../public/js/download.js'

const at = new Date(2026, 8, 17, 19, 4, 5) // 17 Sep 2026, 19:04:05 local

describe('stamp', () => {
  it('pads every part so filenames sort', () => {
    expect(stamp(at)).toBe('2026-09-17-190405')
    expect(stamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02-030405')
  })
})

describe('jsonFilename', () => {
  it('joins the parts and appends a timestamp', () => {
    expect(jsonFilename(['company'], at)).toBe('company-2026-09-17-190405.json')
  })

  it('slugifies anything unsafe for a filename', () => {
    expect(jsonFilename(['GET /open-refresh/list'], at)).toBe('get-open-refresh-list-2026-09-17-190405.json')
  })

  it('keeps ids readable and drops empty parts', () => {
    expect(jsonFilename(['list', '507f1f77bcf86cd799439011', 'page 0'], at)).toBe(
      'list-507f1f77bcf86cd799439011-page-0-2026-09-17-190405.json'
    )
    expect(jsonFilename(['list', '', null, undefined, '  '], at)).toBe('list-2026-09-17-190405.json')
  })

  it('falls back to a name when nothing usable is given', () => {
    expect(jsonFilename([], at)).toBe('response-2026-09-17-190405.json')
    expect(jsonFilename(['!!!'], at)).toBe('response-2026-09-17-190405.json')
  })

  it('accepts a bare string', () => {
    expect(jsonFilename('activity', at)).toBe('activity-2026-09-17-190405.json')
  })
})
