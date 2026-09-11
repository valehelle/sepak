import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLAIM_TOKEN_KEY, getClaimToken, resetClaimTokenCache } from './claimToken'

describe('getClaimToken', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    resetClaimTokenCache()
  })

  it('creates and persists a token on first call', () => {
    const token = getClaimToken()
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(localStorage.getItem(CLAIM_TOKEN_KEY)).toBe(token)
  })

  it('returns the same token on later calls', () => {
    expect(getClaimToken()).toBe(getClaimToken())
  })

  it('replaces a corrupted stored value', () => {
    localStorage.setItem(CLAIM_TOKEN_KEY, 'not-a-uuid')
    const token = getClaimToken()
    expect(token).not.toBe('not-a-uuid')
    expect(localStorage.getItem(CLAIM_TOKEN_KEY)).toBe(token)
  })

  it('still returns a usable token when storage throws', () => {
    // Private browsing and blocked site data make localStorage itself throw.
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      clear: () => {},
      removeItem: () => {},
      key: () => null,
      length: 0,
    })
    expect(getClaimToken()).toMatch(/^[0-9a-f-]{36}$/i)
  })
})
