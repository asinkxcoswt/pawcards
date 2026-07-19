import { describe, expect, test } from 'bun:test'
import { detectPlatform } from '../src/lib/pwa'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

describe('detectPlatform', () => {
  test('iPhone → ios', () => expect(detectPlatform(IPHONE, 5)).toBe('ios'))
  test('Android → android', () => expect(detectPlatform(ANDROID, 5)).toBe('android'))
  test('desktop Mac (no touch) → other', () => expect(detectPlatform(MAC, 0)).toBe('other'))
  test('iPadOS 13+ (Mac UA but touch) → ios', () => expect(detectPlatform(MAC, 5)).toBe('ios'))
  test('Windows desktop → other', () => expect(detectPlatform(WIN, 0)).toBe('other'))
})
