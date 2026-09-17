import { describe, it, expect } from 'vitest'
import { PRESETS, DEFAULT_BASE, normalizeBase, presetFor } from '../public/js/config.js'

describe('base url', () => {
  it('defaults to staging, so a stray click cannot spend production credits', () => {
    expect(PRESETS[0].id).toBe('staging')
    expect(DEFAULT_BASE).toBe(PRESETS[0].url)
    expect(DEFAULT_BASE).not.toBe('https://api.uptodata.io/api')
    expect(normalizeBase(DEFAULT_BASE)).toBe(DEFAULT_BASE)
  })

  it('strips trailing slashes so paths do not double up', () => {
    expect(normalizeBase('https://x.io/api/')).toBe('https://x.io/api')
    expect(normalizeBase('  https://x.io/api//  ')).toBe('https://x.io/api')
  })

  it('handles an empty or missing value', () => {
    expect(normalizeBase('')).toBe('')
    expect(normalizeBase(null)).toBe('')
    expect(normalizeBase(undefined)).toBe('')
  })

  it('recognises a preset and ignores an unknown host', () => {
    expect(presetFor('https://api.uptodata.io/api/').id).toBe('production')
    expect(presetFor('https://api.staging.uptodata.io/api').id).toBe('staging')
    expect(presetFor('https://something-else.io/api')).toBe(null)
  })

  it('every preset url is already normalised', () => {
    for (const preset of PRESETS) expect(normalizeBase(preset.url)).toBe(preset.url)
  })
})
