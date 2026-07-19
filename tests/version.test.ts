import { describe, expect, test } from 'bun:test'
import { needsUpdate } from '../src/lib/version'

describe('update prompt policy (minor/major only)', () => {
  test('patch bump stays silent', () => {
    expect(needsUpdate('3.3.0', '3.3.9')).toBe(false)
  })
  test('minor bump prompts', () => {
    expect(needsUpdate('3.3.0', '3.4.0')).toBe(true)
  })
  test('major bump prompts', () => {
    expect(needsUpdate('3.3.0', '4.0.0')).toBe(true)
    expect(needsUpdate('3.9.0', '4.0.0')).toBe(true) // lower minor, higher major
  })
  test('same or older never prompts', () => {
    expect(needsUpdate('3.3.0', '3.3.0')).toBe(false)
    expect(needsUpdate('3.3.0', '3.2.9')).toBe(false)
    expect(needsUpdate('3.3.0', '2.9.0')).toBe(false)
  })
  test('malformed versions never prompt', () => {
    expect(needsUpdate('3.3.0', 'oops')).toBe(false)
    expect(needsUpdate('3.3.0', '')).toBe(false)
  })
})
