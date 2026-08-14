import { describe, expect, it } from 'vitest'

import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import { validateStructuredFactualOutput } from './factualValidator'
import { enforceFactualCoverage } from './factualCoverage'
import type { StructuredFactualOutput } from './structuredFactualOutput'

function contract(): TerritorialFactualContract {
  const parcelClassification = {
    code: 'SNR',
    label: 'Suelo de núcleo rural',
    semanticCompleteness: 'complete' as const,
    status: 'automatic_confirmed' as const,
    determination: 'automatic' as const,
  }
  const actionAreaClassification = { ...parcelClassification }
  const parcelCategories = [
    {
      code: 'SNRC',
      label: 'Núcleo Rural Común',
      semanticCompleteness: 'complete' as const,
      status: 'conflict' as const,
      determination: 'unresolved' as const,
      parcelPercentage: 98.53,
    },
    {
      code: 'SNRT',
      label: 'Núcleo Rural Tradicional',
      semanticCompleteness: 'complete' as const,
      status: 'conflict' as const,
      determination: 'unresolved' as const,
      parcelPercentage: 1.47,
    },
  ]
  const actionAreaCategories = [{
    code: 'SNRC',
    label: 'Núcleo Rural Común',
    semanticCompleteness: 'complete' as const,
    status: 'manual_review_required' as const,
    determination: 'manual' as const,
  }]

  return {
    identity: { municipalityName: 'Sada' },
    scopes: {
      parcel: { areaSquareMetres: 1790.46, hasGeometry: true },
      actionArea: { areaSquareMetres: 1764.22, hasGeometry: true },
    },
    factsByScope: {
      parcel: { classification: parcelClassification, categories: parcelCategories },
      actionArea: { classification: actionAreaClassification, categories: actionAreaCategories },
    },
    classification: actionAreaClassification,
    categories: actionAreaCategories,
    consolidation: { status: 'unresolved', determination: 'unresolved' },
    planningAreas: [],
    affects: { status: 'checked', items: [] },
    normativeReferences: {},
  }
}

function output(operations: StructuredFactualOutput['operations']): StructuredFactualOutput {
  return { operations, abstentions: [] }
}

const sadaQuestion = '¿Puedo considerar toda la parcela como Núcleo Rural Común (SNRC)?'

describe('deterministic factual coverage', () => {
  it('completa Sada con SNRT 1,47 cuando el LLM solo selecciona SNRC 98,53', () => {
    const initial = output([
      {
        operation: 'state_percentage',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        percentage: 98.53,
      },
      {
        operation: 'state_geometric_dominance',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      },
      {
        operation: 'state_conflict',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      },
      {
        operation: 'state_determination',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        determination: 'unresolved',
      },
    ])

    const result = enforceFactualCoverage(sadaQuestion, contract(), initial)

    expect(result.diagnostics).toEqual({
      coverageRequiredCount: 4,
      coverageSelectedCount: 3,
      coverageAddedCount: 1,
      coverageComplete: true,
      coverageReason: 'completed_deterministically',
    })
    expect(result.output.operations).toContainEqual({
      operation: 'state_percentage',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRT' },
      percentage: 1.47,
    })
  })

  it('conserva porcentajes exactos y nunca redondea 98,53 a 100', () => {
    const result = enforceFactualCoverage(sadaQuestion, contract(), output([]))
    const percentages = result.output.operations
      .filter((operation) => operation.operation === 'state_percentage')
      .map((operation) => operation.percentage)

    expect(percentages).toEqual([98.53, 1.47])
    expect(percentages).not.toContain(100)
  })

  it('conserva dominance, conflict y unresolved sin convertirlos en effective', () => {
    const initial = output([
      {
        operation: 'state_geometric_dominance',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      },
      {
        operation: 'state_conflict',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      },
      {
        operation: 'state_determination',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        determination: 'unresolved',
      },
    ])

    const result = enforceFactualCoverage(sadaQuestion, contract(), initial)

    expect(result.output.operations).toEqual(expect.arrayContaining(initial.operations))
    expect(result.output.operations).not.toContainEqual(expect.objectContaining({
      operation: 'state_status', status: 'effective',
    }))
    expect(result.output.operations).not.toContainEqual(expect.objectContaining({
      operation: 'state_determination', determination: 'effective',
    }))
  })

  it('no mezcla parcel y actionArea', () => {
    const result = enforceFactualCoverage(
      '¿Qué categorías urbanísticas existen en la parcela catastral completa?',
      contract(),
      output([])
    )

    expect(result.diagnostics.coverageComplete).toBe(true)
    expect(result.output.operations.every((operation) => operation.factRef.scope === 'parcel'))
      .toBe(true)
  })

  it('actionArea simple añade solo classification y SNRC del actionArea', () => {
    const result = enforceFactualCoverage(
      '¿Qué categoría tiene el área seleccionada?',
      contract(),
      output([])
    )

    expect(result.diagnostics.coverageComplete).toBe(true)
    expect(result.output.operations.every((operation) => operation.factRef.scope === 'actionArea'))
      .toBe(true)
    expect(result.output.operations).toContainEqual(expect.objectContaining({
      operation: 'state_label',
      factRef: { type: 'classification', scope: 'actionArea' },
    }))
    expect(result.output.operations).toContainEqual(expect.objectContaining({
      operation: 'state_label',
      factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' },
    }))
    expect(JSON.stringify(result.output)).not.toContain('SNRT')
  })

  it('no duplica cuando el LLM ya cubrió todas las categorías pertinentes', () => {
    const complete = output([
      {
        operation: 'state_percentage',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        percentage: 98.53,
      },
      {
        operation: 'state_percentage',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRT' },
        percentage: 1.47,
      },
      {
        operation: 'state_conflict',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      },
      {
        operation: 'state_determination',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        determination: 'unresolved',
      },
    ])

    const result = enforceFactualCoverage(sadaQuestion, contract(), complete)

    expect(result.output).toBe(complete)
    expect(result.diagnostics.coverageAddedCount).toBe(0)
    expect(result.diagnostics.coverageReason).toBe('already_complete')
  })

  it('candidate sin porcentaje usa identidad y no inventa percentage', () => {
    const result = enforceFactualCoverage(
      '¿Qué categoría tiene el área seleccionada?',
      contract(),
      output([])
    )

    expect(result.output.operations).toContainEqual({
      operation: 'state_label',
      factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' },
      label: 'Núcleo Rural Común',
    })
    expect(result.output.operations.some((operation) =>
      operation.operation === 'state_percentage' && operation.factRef.scope === 'actionArea'
    )).toBe(false)
  })

  it('semantic completeness partial usa code y no inventa label', () => {
    const partial = contract()
    partial.factsByScope!.actionArea!.categories = [{
      code: 'SNRC',
      semanticCompleteness: 'partial',
      status: 'automatic_confirmed',
      determination: 'automatic',
    }]

    const result = enforceFactualCoverage(
      '¿Qué categoría tiene el área seleccionada?',
      partial,
      output([])
    )

    expect(result.output.operations).toContainEqual({
      operation: 'reference_code',
      factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' },
      code: 'SNRC',
    })
    expect(result.output.operations.some((operation) => operation.operation === 'state_label' &&
      operation.factRef.type === 'category')).toBe(false)
  })

  it('category question incluye todas las categorías pertinentes del scope', () => {
    const result = enforceFactualCoverage(
      '¿Qué categorías urbanísticas existen en la parcela catastral completa?',
      contract(),
      output([])
    )
    const categoryCodes = result.output.operations
      .filter((operation) => operation.factRef.type === 'category')
      .map((operation) => operation.factRef.type === 'category' ? operation.factRef.code : '')

    expect(new Set(categoryCodes)).toEqual(new Set(['SNRC', 'SNRT']))
  })

  it('confirmation/homogeneity incluye la categoría residual', () => {
    const result = enforceFactualCoverage(sadaQuestion, contract(), output([
      {
        operation: 'state_percentage',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        percentage: 98.53,
      },
    ]))

    expect(result.output.operations).toContainEqual(expect.objectContaining({
      factRef: { type: 'category', scope: 'parcel', code: 'SNRT' },
    }))
  })

  it('classification-only completa únicamente classification en el scope solicitado', () => {
    const result = enforceFactualCoverage(
      '¿Qué clasificación tiene el área seleccionada?',
      contract(),
      output([])
    )

    expect(result.output.operations).toEqual([{
      operation: 'state_label',
      factRef: { type: 'classification', scope: 'actionArea' },
      label: 'Suelo de núcleo rural',
    }])
  })

  it('mezcla de scopes se marca incompleta y no se corrige silenciosamente', () => {
    const initial = output([{
      operation: 'state_label',
      factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' },
      label: 'Núcleo Rural Común',
    }])

    const result = enforceFactualCoverage(sadaQuestion, contract(), initial)

    expect(result.output).toBe(initial)
    expect(result.diagnostics).toEqual(expect.objectContaining({
      coverageComplete: false,
      coverageReason: 'scope_mismatch',
      coverageAddedCount: 0,
    }))
  })

  it('categoría ambigua no se marca completa ni se rellena', () => {
    const ambiguous = contract()
    ambiguous.factsByScope!.parcel!.categories!.push({
      ...ambiguous.factsByScope!.parcel!.categories![0],
    })

    const result = enforceFactualCoverage(sadaQuestion, ambiguous, output([]))

    expect(result.diagnostics.coverageComplete).toBe(false)
    expect(result.diagnostics.coverageReason).toBe('ambiguous_category')
    expect(result.output.operations).toEqual([])
  })

  it('categoría irrepresentable sin code conserva fallback seguro', () => {
    const unsafe = contract()
    unsafe.factsByScope!.parcel!.categories = [{
      label: 'Sin código',
      semanticCompleteness: 'complete',
      status: 'automatic_confirmed',
      determination: 'automatic',
    }]

    const result = enforceFactualCoverage(sadaQuestion, unsafe, output([]))

    expect(result.diagnostics.coverageComplete).toBe(false)
    expect(result.diagnostics.coverageReason).toBe('unrepresentable_category')
    expect(result.output.operations).toEqual([])
  })

  it('las operaciones completadas vuelven a pasar el validator sin debilitarlo', () => {
    const factualContract = contract()
    const result = enforceFactualCoverage(sadaQuestion, factualContract, output([]))

    expect(validateStructuredFactualOutput(result.output, factualContract)).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    })
  })

  it('un intent sin cobertura global conserva la selección y no añade facts', () => {
    const initial = output([{
      operation: 'state_percentage',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      percentage: 98.53,
    }])

    const result = enforceFactualCoverage(
      '¿Qué porcentaje ocupa SNRC en toda la parcela?',
      contract(),
      initial
    )

    expect(result.output).toBe(initial)
    expect(result.diagnostics.coverageReason).toBe('not_required')
  })
})
