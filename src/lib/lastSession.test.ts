import { beforeEach, describe, expect, it } from 'vitest'
import { LAST_SESSION_KEY, recallSession, rememberSession } from './lastSession'

const ID = 'b8630d98-cc10-47f0-b709-ca2343b25a3b'

describe('lastSession', () => {
  beforeEach(() => localStorage.clear())

  it('remembers nothing on a fresh device', () => {
    expect(recallSession()).toBeNull()
  })

  it('round-trips a session id', () => {
    rememberSession(ID)
    expect(recallSession()).toBe(ID)
  })

  it('refuses to store anything that is not an id', () => {
    rememberSession('../admin')
    expect(localStorage.getItem(LAST_SESSION_KEY)).toBeNull()
  })

  it('ignores a corrupted value rather than routing to it', () => {
    // Whatever wrote this, it is not going into a URL.
    localStorage.setItem(LAST_SESSION_KEY, 'javascript:alert(1)')
    expect(recallSession()).toBeNull()
  })
})
