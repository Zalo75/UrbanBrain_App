import { describe, expect, it, vi } from 'vitest'
import { SiotugaDetailedZoningDocumentValidator } from './SiotugaDetailedZoningDocumentValidator'

vi.mock('pdf-parse/lib/pdf-parse.js', () => ({ default: vi.fn(async () => ({ text: 'CAP. 3. ORDENANZA 1ª. ZONA RESIDENCIAL INTENSIVA.\f' })) }))

const document = (instrumentId: string) => ({
  id: 'doc-1', instrumentId, title: 'Normativa', sourceUrl: 'https://official.invalid/doc.pdf', binding: 'general' as const, documentType: 'normative_text' as const,
})

describe('SiotugaDetailedZoningDocumentValidator', () => {
  it('matches a graphic label only in the same instrument', async () => {
    const result = await new SiotugaDetailedZoningDocumentValidator(async () => new Response('pdf')).validate({
      observedLabel: '1', instrumentId: 'current', documents: [document('current')],
    })
    expect(result).toMatchObject({ identity: 'CAP. 3. ORDENANZA 1ª. ZONA RESIDENCIAL INTENSIVA.' })
  })

  it('rejects documents from another instrument', async () => {
    const result = await new SiotugaDetailedZoningDocumentValidator(async () => new Response('pdf')).validate({
      observedLabel: '1', instrumentId: 'current', documents: [document('historical')],
    })
    expect(result).toBeNull()
  })
})
