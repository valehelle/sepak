import { afterEach, describe, expect, it } from 'vitest'
import { isIosNonSafari, isStandalone, pushCapability } from './pushCapability'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36'

type Options = {
  ua: string
  standalone?: boolean
  displayMode?: boolean
  push?: boolean
  permission?: NotificationPermission
  touchPoints?: number
}

/** jsdom has neither matchMedia nor Notification, and navigator.standalone
 *  exists on no engine but WebKit -- so each case builds the browser it
 *  means to describe. */
function browser({ ua, standalone, displayMode = false, push = true, permission = 'default', touchPoints = 0 }: Options) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true })
  if (standalone === undefined) {
    Reflect.deleteProperty(window.navigator, 'standalone')
  } else {
    Object.defineProperty(window.navigator, 'standalone', { value: standalone, configurable: true })
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: query.includes('standalone') ? displayMode : false }),
  })
  if (push) {
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true })
    Object.defineProperty(window, 'Notification', { value: { permission }, configurable: true })
  } else {
    Reflect.deleteProperty(window, 'PushManager')
    Reflect.deleteProperty(window, 'Notification')
    Reflect.deleteProperty(navigator, 'serviceWorker')
  }
}

describe('pushCapability', () => {
  afterEach(() => {
    Reflect.deleteProperty(window.navigator, 'standalone')
  })

  it('tells an iPhone in a Safari tab to install first', () => {
    browser({ ua: IPHONE, standalone: false })
    expect(pushCapability()).toBe('needs-install')
  })

  it('is ready in an installed iOS app', () => {
    browser({ ua: IPHONE, standalone: true })
    expect(pushCapability()).toBe('ready')
  })

  it('treats an iPad reporting itself as a Mac as iOS', () => {
    browser({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', touchPoints: 5 })
    expect(pushCapability()).toBe('needs-install')
  })

  it('is ready on Android in an ordinary tab, with no install needed', () => {
    browser({ ua: ANDROID })
    expect(pushCapability()).toBe('ready')
  })

  it('reports a previous refusal as blocked, since a browser will not ask twice', () => {
    browser({ ua: ANDROID, permission: 'denied' })
    expect(pushCapability()).toBe('blocked')
  })

  it('reports a browser without push as unsupported', () => {
    browser({ ua: ANDROID, push: false })
    expect(pushCapability()).toBe('unsupported')
  })

  it('prefers the install advice over "unsupported" on iOS, which is the actionable answer', () => {
    browser({ ua: IPHONE, push: false })
    expect(pushCapability()).toBe('needs-install')
  })

  it('recognises an installed app through display-mode when navigator.standalone is absent', () => {
    browser({ ua: ANDROID, displayMode: true })
    expect(isStandalone()).toBe(true)
  })

  it('spots Chrome on iOS, where adding to the home screen would not help', () => {
    browser({ ua: IPHONE_CHROME })
    expect(isIosNonSafari()).toBe(true)
    browser({ ua: IPHONE })
    expect(isIosNonSafari()).toBe(false)
    browser({ ua: ANDROID })
    expect(isIosNonSafari()).toBe(false)
  })
})
