import { describe, expect, it } from 'vitest'
import { validationErrorFields } from './api-errors'

describe('validationErrorFields', () => {
  it('lists the body fields of a FastAPI validation error', () => {
    const body = JSON.stringify({
      detail: [
        { loc: ['body', 'orcid'], msg: 'Value error, ORCID iD checksum does not match', type: 'value_error' },
        { loc: ['query', 'limit'], msg: 'x' },
      ],
    })
    expect(validationErrorFields(body)).toEqual(['orcid'])
  })

  it.each(['not json', '{"detail":"Not found"}', '{"detail":{"code":"password_common"}}', 'null'])(
    'is empty for %s',
    (body) => {
      expect(validationErrorFields(body)).toEqual([])
    },
  )
})
