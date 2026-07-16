import { describe, expect, it } from 'vitest'

import { getInitialContextAcceptance } from './creationContext'

describe('getInitialContextAcceptance', () => {
  it('mantiene separadas la aceptación inicial y la revisión técnica', () => {
    const formData = new FormData()
    formData.set('initialContextNoticeAccepted', 'true')
    formData.set('contextoValidadoPorTecnico', 'true')

    expect(getInitialContextAcceptance(formData)).toEqual({
      noticeAccepted: true,
      technicallyReviewed: false,
    })
  })

  it('exige la aceptación expresa del aviso inicial', () => {
    expect(getInitialContextAcceptance(new FormData())).toEqual({
      noticeAccepted: false,
      technicallyReviewed: false,
    })
  })
})
