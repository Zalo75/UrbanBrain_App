import { describe, expect, it } from 'vitest'

import {
  addChunkQualityResult,
  createChunkQualityStatistics,
  evaluateChunkTextQuality,
} from './chunkTextQuality'

const corruptSamples = [
  {
    text: '( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( (',
    expectedReason: 'EXTREME_SYMBOL_REPETITION' as const,
  },
  {
    text: 'S S S/N SNRC-0101-1 Beade SRPIN SRPIN SRPAU SRPF PVC75Ø 556.300 556.400…',
    expectedReason: 'CODE_SEQUENCE_DOMINATED' as const,
  },
  {
    text: ': : 5 : : 4 : : 8 : : 10 SNRC-3 O-IC SRPIN SRPAU…',
    expectedReason: 'CODE_SEQUENCE_DOMINATED' as const,
  },
]

describe('evaluateChunkTextQuality', () => {
  it.each(corruptSamples)('rechaza OCR cartográfico o texto corrupto', ({ text, expectedReason }) => {
    const result = evaluateChunkTextQuality({ text, chunkType: 'BLOQUE' })

    expect(result.eligible).toBe(false)
    expect(result.reasonCodes).toContain(expectedReason)
    expect(result.metrics.characterCount).toBeGreaterThan(0)
  })

  it('rechaza corrupción inequívoca aunque el tipo jurídico esté protegido', () => {
    const result = evaluateChunkTextQuality({
      text: '( ( ( ( ( ( ( ( ( ( ( (',
      chunkType: 'ARTICULO',
    })

    expect(result.eligible).toBe(false)
    expect(result.metrics.protectedLegalChunkType).toBe(true)
    expect(result.reasonCodes).toContain('EXTREME_SYMBOL_REPETITION')
  })

  it.each([
    {
      chunkType: 'ARTICULO',
      text: 'Artículo 12. Condiciones de la edificación. La ocupación máxima será del 60 % de la parcela y la altura no superará 7,00 metros.',
    },
    {
      chunkType: 'ORDENANZA',
      text: 'Ordenanza 3.ª, zona R-2. Se permite vivienda unifamiliar con una edificabilidad máxima de 0,50 m²/m² y retranqueo de 3 m.',
    },
    {
      chunkType: 'BLOQUE',
      text: 'Uso | Parcela mínima (m²) | Ocupación máxima (%)\nResidencial | 300 | 60\nDotacional | 500 | 40',
    },
    {
      chunkType: 'SECCION',
      text: 'Sección 4. Condicións de uso. As edificacións deberán respectar os recuamentos establecidos no planeamento municipal.',
    },
    {
      chunkType: 'ANEXO',
      text: 'Anexo I. Plano e cadro de superficies útiles.',
    },
    {
      chunkType: 'CAPITULO',
      text: 'CAPÍTULO II. RÉXIME DO SOLO E CONDICIÓNS XERAIS DE EDIFICACIÓN.',
    },
  ])('conserva texto jurídico legítimo de tipo $chunkType', ({ text, chunkType }) => {
    const result = evaluateChunkTextQuality({ text, chunkType })

    expect(result.eligible).toBe(true)
    expect(result.reasonCodes).toEqual([])
  })

  it('conserva coordenadas y códigos cuando forman parte de una frase normativa natural', () => {
    const result = evaluateChunkTextQuality({
      chunkType: 'BLOQUE',
      text: 'El límite del ámbito discurre desde el punto UTM X=556.300, Y=4.789.200 hasta la parcela 1234567AB1234C, conforme al plano oficial.',
    })

    expect(result.eligible).toBe(true)
    expect(result.metrics.naturalSentenceCount).toBeGreaterThan(0)
  })

  it('acumula únicamente contadores agregados y motivos', () => {
    const eligible = evaluateChunkTextQuality({
      text: 'Artículo 5. Parcela mínima: 300 m².',
      chunkType: 'ARTICULO',
    })
    const rejected = evaluateChunkTextQuality({ text: '( ( ( ( ( ( ( (', chunkType: 'BLOQUE' })
    const statistics = addChunkQualityResult(
      addChunkQualityResult(createChunkQualityStatistics(), eligible),
      rejected
    )

    expect(statistics.evaluated).toBe(2)
    expect(statistics.eligible).toBe(1)
    expect(statistics.rejected).toBe(1)
    expect(statistics.rejectedByReason.EXTREME_SYMBOL_REPETITION).toBe(1)
    expect(JSON.stringify(statistics)).not.toContain('Parcela mínima')
  })
})
