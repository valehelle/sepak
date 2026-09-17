import { beforeEach, describe, expect, it } from 'vitest'
import { PLAYER_MEMORY_KEY, recallPlayer, rememberPlayer } from './playerMemory'

describe('playerMemory', () => {
  beforeEach(() => localStorage.clear())

  it('remembers nothing on a fresh device', () => {
    expect(recallPlayer()).toEqual({ name: '', phone: '' })
  })

  it('round-trips name and phone', () => {
    rememberPlayer({ name: 'Hazmi', phone: '60123456789' })
    expect(recallPlayer()).toEqual({ name: 'Hazmi', phone: '60123456789' })
  })

  it('ignores a corrupted value rather than throwing', () => {
    localStorage.setItem(PLAYER_MEMORY_KEY, '{not json')
    expect(recallPlayer()).toEqual({ name: '', phone: '' })
    localStorage.setItem(PLAYER_MEMORY_KEY, JSON.stringify({ name: 42 }))
    expect(recallPlayer()).toEqual({ name: '', phone: '' })
  })
})
