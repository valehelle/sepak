import { describe, expect, it } from 'vitest'
import { describeBrowser } from './browser'

const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const IOS_HOME_SCREEN =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1'
const IOS_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 354.0.0.0.0'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36'
const ANDROID_SAMSUNG =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36'
const ANDROID_FACEBOOK =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/489.0.0.0;]'

describe('describeBrowser', () => {
  it('names Safari only when the user agent says Safari', () => {
    expect(describeBrowser(IOS_SAFARI)).toBe('iPhone · Safari')
    expect(describeBrowser(IOS_HOME_SCREEN)).toBe('iPhone · app / skrin utama')
  })

  it('tells the other iPhone browsers apart from Safari', () => {
    expect(describeBrowser(IOS_CHROME)).toBe('iPhone · Chrome')
    expect(describeBrowser(IOS_INSTAGRAM)).toBe('iPhone · Instagram')
  })

  it('tells an Android app showing the page apart from Chrome', () => {
    expect(describeBrowser(ANDROID_CHROME)).toBe('Android · Chrome')
    expect(describeBrowser(ANDROID_WEBVIEW)).toBe('Android · browser dalam app')
    expect(describeBrowser(ANDROID_FACEBOOK)).toBe('Android · Facebook')
    expect(describeBrowser(ANDROID_SAMSUNG)).toBe('Android · Samsung Internet')
  })

  it('still says something for a user agent it does not know', () => {
    expect(describeBrowser('curl/8.7.1')).toBe('lain-lain')
  })
})
