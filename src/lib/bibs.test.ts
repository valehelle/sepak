import { describe, expect, it } from 'vitest'
import { bibFor } from './bibs'

describe('bibFor', () => {
  it('takes the colour from the name, so two teams can share a bib', () => {
    expect(bibFor('A', 'Merah')).toBe('merah')
    expect(bibFor('B', 'Merah')).toBe('merah')
    expect(bibFor('C', 'Kuning')).toBe('kuning')
    expect(bibFor('D', 'Kuning')).toBe('kuning')
    expect(bibFor('B', 'Putih')).toBe('putih')
  })

  it('reads English and names with extra words', () => {
    expect(bibFor('A', 'red')).toBe('merah')
    expect(bibFor('D', 'Kuning 2')).toBe('kuning')
    expect(bibFor('C', 'White')).toBe('putih')
  })

  it('falls back to the team letter for a name that is not a colour', () => {
    expect(bibFor('A', 'Harimau')).toBe('merah')
    expect(bibFor('B', 'Harimau')).toBe('putih')
    expect(bibFor('C', 'Harimau')).toBe('kuning')
  })
})
