import { describe, expect, it } from 'vitest'

import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type { TerritorialShadowResult } from './shadowPipeline'
import {
  isSynchronousFactualEnabled,
  shouldRunVisibleFactual,
  visibleFactualAnswer,
} from './visibleFactualRouting'

function contract(): TerritorialFactualContract {
  const classification = {
    code: 'SNR',
    label: 'Suelo de núcleo rural',
    semanticCompleteness: 'complete' as const,
    status: 'automatic_confirmed' as const,
    determination: 'automatic' as const,
  }
  const parcelCategories = [
    {
      code: 'SNRC', label: 'Núcleo Rural Común', semanticCompleteness: 'complete' as const,
      status: 'conflict' as const, determination: 'unresolved' as const, parcelPercentage: 98.53,
    },
    {
      code: 'SNRT', label: 'Núcleo Rural Tradicional', semanticCompleteness: 'complete' as const,
      status: 'conflict' as const, determination: 'unresolved' as const, parcelPercentage: 1.47,
    },
  ]
  const actionAreaCategories = [{
    code: 'SNRC', label: 'Núcleo Rural Común', semanticCompleteness: 'complete' as const,
    status: 'manual_review_required' as const, determination: 'manual' as const,
  }]

  return {
    identity: { municipalityName: 'Sada' },
    scopes: {
      parcel: { areaSquareMetres: 1790.46, hasGeometry: true },
      actionArea: { areaSquareMetres: 1764.22, hasGeometry: true },
    },
    factsByScope: {
      parcel: { classification, categories: parcelCategories },
      actionArea: { classification, categories: actionAreaCategories },
    },
    classification,
    categories: actionAreaCategories,
    consolidation: { status: 'unresolved', determination: 'unresolved' },
    planningAreas: [],
    affects: { status: 'checked', items: [] },
    normativeReferences: {},
  }
}

function result(overrides: Partial<TerritorialShadowResult> = {}): TerritorialShadowResult {
  return {
    status: 'valid',
    structuredOutput: {
      operations: [{
        operation: 'state_percentage',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        percentage: 98.53,
      }],
      abstentions: [],
    },
    renderedText: ['La categoría SNRC representa el 98,53 % de la parcela.'],
    diagnostics: { latencyMs: 10, model: 'deepseek-v4-flash' },
    ...overrides,
  }
}

describe('visible factual routing', () => {
  it.each([
    [undefined, false],
    ['false', false],
    ['TRUE', false],
    ['1', false],
    ['true', true],
  ])('uses only the exact feature flag value %s', (value, expected) => {
    expect(isSynchronousFactualEnabled(value)).toBe(expected)
  })

  it.each([
    '¿Qué categoría urbanística tiene exactamente el área que tengo seleccionada en el visor?',
    '¿Qué clasificación tiene el área seleccionada?',
    '¿Qué categorías urbanísticas existen en la parcela catastral completa?',
    '¿Puedo considerar toda la parcela como Núcleo Rural Común (SNRC)?',
    '¿Qué porcentaje de toda la parcela es SNRC?',
    '¿Qué parte corresponde a cada categoría en toda la parcela?',
    '¿Existe conflicto o sigue sin resolver la categoría de toda la parcela?',
  ])('routes the covered territorial question: %s', (question) => {
    expect(shouldRunVisibleFactual(question, contract())).toBe(true)
  })

  it.each([
    '¿Cuál es la ocupación máxima de NRC-1?',
    '¿Qué retranqueos se aplican?',
    '¿Qué usos permitidos tiene SNRC?',
    '¿Qué ordenanza y artículos se aplican?',
    '¿Qué exige el CTE?',
    'Hola, ¿puedes ayudarme?',
  ])('keeps normative, parameter and general questions in Primary: %s', (question) => {
    expect(shouldRunVisibleFactual(question, contract())).toBe(false)
  })

  it('requires percentages in the requested parcel scope and never borrows actionArea facts', () => {
    const withoutParcelPercentages = contract()
    withoutParcelPercentages.factsByScope!.parcel!.categories = undefined

    expect(shouldRunVisibleFactual('¿Qué porcentaje tiene toda la parcela?', withoutParcelPercentages))
      .toBe(false)
    expect(shouldRunVisibleFactual('¿Qué categoría tiene el área seleccionada?', withoutParcelPercentages))
      .toBe(true)
  })

  it.each([
    ['llm_failed', result({ status: 'llm_failed' })],
    ['validation_failed', result({ status: 'validation_failed' })],
    ['render_failed', result({ status: 'render_failed' })],
    ['empty rendering', result({ renderedText: ['  '] })],
    ['abstention', result({ structuredOutput: { operations: [], abstentions: [{ cause: 'unresolved_fact' }] } })],
  ])('rejects %s and enables the Primary fallback', (_case, pipelineResult) => {
    expect(visibleFactualAnswer(pipelineResult)).toBeNull()
  })

  it('keeps the renderer text and exact percentage unchanged', () => {
    expect(visibleFactualAnswer(result())).toBe(
      'La categoría SNRC representa el 98,53 % de la parcela.'
    )
  })
})
