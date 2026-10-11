// Adapted from linkr@1310cf4a4 apps/web/src/lib/fold-accents.test.ts (alias/slug cases dropped)
import { describe, expect, it } from 'vitest'
import { foldAccents } from './fold-accents'

describe('foldAccents', () => {
  it('drops accents and spells out ligatures', () => {
    expect(foldAccents('Patients masculins décédés')).toBe('Patients masculins decedes')
    expect(foldAccents('Cœur, Æther, Straße, Ørsted, Łódź')).toBe('Coeur, AEther, Strasse, Orsted, Lodz')
  })

  it('leaves ASCII alone', () => {
    expect(foldAccents('MIMIC-IV (raw)')).toBe('MIMIC-IV (raw)')
  })
})

