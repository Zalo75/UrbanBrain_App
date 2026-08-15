import { describe, expect, it } from 'vitest'
import type { FactualScopeFacts, TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import { validateStructuredFactualOutput } from './factualValidator'
import type { StructuredFactualOutput } from './structuredFactualOutput'

const baseParcelFacts = (): FactualScopeFacts => ({
  classification: {
    code: 'SU',
    label: 'Suelo Urbano',
    semanticCompleteness: 'complete',
    status: 'automatic_confirmed',
    determination: 'automatic',
  },
  categories: [
    {
      code: 'SNRC',
      label: 'Nucleo rural comun',
      semanticCompleteness: 'complete',
      status: 'automatic_confirmed',
      determination: 'automatic',
      parcelPercentage: 98.53,
    },
    {
      code: 'SNRT',
      semanticCompleteness: 'partial',
      status: 'automatic_confirmed',
      determination: 'automatic',
      parcelPercentage: 1.47,
    },
  ],
  consolidation: {
    status: 'unresolved',
    determination: 'unresolved',
  },
  planningAreas: [
    {
      code: 'P-1',
      semanticCompleteness: 'partial',
      status: 'automatic_confirmed',
      determination: 'automatic',
    },
  ],
  affects: {
    status: 'checked',
    items: [
      {
        label: 'Patrimonio: casco historico',
        status: 'automatic_confirmed',
        determination: 'effective',
      },
    ],
  },
})

function createContract(factsByScope?: TerritorialFactualContract['factsByScope']): TerritorialFactualContract {
  const legacy = baseParcelFacts()

  return {
    identity: {},
    scopes: {
      parcel: { areaSquareMetres: 1000, hasGeometry: true, source: 'catastro' },
      actionArea: { areaSquareMetres: 200, hasGeometry: true, source: 'user_polygon' },
    },
    factsByScope,
    classification: legacy.classification!,
    categories: legacy.categories!,
    consolidation: legacy.consolidation!,
    planningAreas: legacy.planningAreas!,
    affects: legacy.affects!,
    normativeReferences: {},
  }
}

function validate(
  contract: TerritorialFactualContract,
  operations: StructuredFactualOutput['operations'],
  abstentions: StructuredFactualOutput['abstentions'] = []
) {
  return validateStructuredFactualOutput({ operations, abstentions }, contract)
}

describe('Structured Factual Validator - scoped unique refs', () => {
  it('A - parcel resuelve exclusivamente classification de parcel', () => {
    const parcel = baseParcelFacts()
    const actionArea: FactualScopeFacts = {
      ...baseParcelFacts(),
      classification: {
        code: 'SR',
        label: 'Suelo Rustico',
        semanticCompleteness: 'complete',
        status: 'technician_validated',
        determination: 'effective',
      },
    }
    const result = validate(createContract({ parcel, actionArea }), [
      {
        operation: 'state_label',
        factRef: { type: 'classification', scope: 'parcel' },
        label: 'Suelo Urbano',
      },
    ])

    expect(result.valid).toBe(true)
  })

  it('B - actionArea resuelve exclusivamente classification de actionArea', () => {
    const actionArea: FactualScopeFacts = {
      ...baseParcelFacts(),
      classification: {
        code: 'SR',
        label: 'Suelo Rustico',
        semanticCompleteness: 'complete',
        status: 'technician_validated',
        determination: 'effective',
      },
    }
    const result = validate(createContract({ parcel: baseParcelFacts(), actionArea }), [
      {
        operation: 'state_label',
        factRef: { type: 'classification', scope: 'actionArea' },
        label: 'Suelo Rustico',
      },
    ])

    expect(result.valid).toBe(true)
  })

  it('C/Q - mismo code en ambos scopes resuelve el fact correcto sin ambiguedad', () => {
    const parcel = baseParcelFacts()
    const actionArea: FactualScopeFacts = {
      ...baseParcelFacts(),
      categories: [
        {
          code: 'SNRC',
          label: 'SNRC area seleccionada',
          semanticCompleteness: 'complete',
          status: 'technician_validated',
          determination: 'effective',
          parcelPercentage: 75,
        },
      ],
    }
    const contract = createContract({ parcel, actionArea })

    expect(
      validate(contract, [
        {
          operation: 'state_percentage',
          factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
          percentage: 98.53,
        },
      ]).valid
    ).toBe(true)
    expect(
      validate(contract, [
        {
          operation: 'state_percentage',
          factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' },
          percentage: 75,
        },
      ]).valid
    ).toBe(true)
  })

  it('D - fact exclusivo de parcel referenciado como actionArea falla', () => {
    const result = validate(
      createContract({
        parcel: baseParcelFacts(),
        actionArea: { classification: baseParcelFacts().classification },
      }),
      [
        {
          operation: 'reference_code',
          factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' },
          code: 'SNRC',
        },
      ]
    )

    expect(result.errors[0].code).toBe('INVALID_FACT_REF')
  })

  it('E - fact exclusivo de actionArea referenciado como parcel falla', () => {
    const result = validate(
      createContract({
        parcel: { classification: baseParcelFacts().classification },
        actionArea: baseParcelFacts(),
      }),
      [
        {
          operation: 'reference_code',
          factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
          code: 'SNRC',
        },
      ]
    )

    expect(result.errors[0].code).toBe('INVALID_FACT_REF')
  })

  it('F - dos categories con mismo code dentro del scope son ambiguas', () => {
    const parcel = baseParcelFacts()
    parcel.categories = [parcel.categories![0], { ...parcel.categories![0] }]
    const result = validate(createContract({ parcel }), [
      {
        operation: 'reference_code',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        code: 'SNRC',
      },
    ])

    expect(result.errors[0].code).toBe('AMBIGUOUS_FACT_REF')
  })

  it('G - dos planningAreas con mismo code dentro del scope son ambiguas', () => {
    const parcel = baseParcelFacts()
    parcel.planningAreas = [parcel.planningAreas![0], { ...parcel.planningAreas![0] }]
    const result = validate(createContract({ parcel }), [
      {
        operation: 'reference_code',
        factRef: { type: 'planning_area', scope: 'parcel', code: 'P-1' },
        code: 'P-1',
      },
    ])

    expect(result.errors[0].code).toBe('AMBIGUOUS_FACT_REF')
  })

  it('H - dos affects con la misma identidad dentro del scope son ambiguos', () => {
    const parcel = baseParcelFacts()
    parcel.affects!.items = [parcel.affects!.items[0], { ...parcel.affects!.items[0] }]
    const result = validate(createContract({ parcel }), [
      {
        operation: 'state_status',
        factRef: {
          type: 'affect',
          scope: 'parcel',
          label: 'Patrimonio: casco historico',
        },
        status: 'automatic_confirmed',
      },
    ])

    expect(result.errors[0].code).toBe('AMBIGUOUS_FACT_REF')
  })

  it('category candidates duplicados dentro del scope son ambiguos', () => {
    const parcel = baseParcelFacts()
    parcel.categories = [
      {
        code: 'CAT',
        status: 'conflict',
        determination: 'unresolved',
        candidates: [
          { code: 'C-1', semanticCompleteness: 'partial' },
          { code: 'C-1', semanticCompleteness: 'partial' },
        ],
      },
    ]
    const result = validate(createContract({ parcel }), [
      {
        operation: 'reference_code',
        factRef: {
          type: 'category_candidate',
          scope: 'parcel',
          categoryCode: 'CAT',
          candidateCode: 'C-1',
        },
        code: 'C-1',
      },
    ])

    expect(result.errors[0].code).toBe('AMBIGUOUS_FACT_REF')
  })

  it('I - 0 coincidencias produce INVALID_FACT_REF', () => {
    const result = validate(createContract({ parcel: baseParcelFacts() }), [
      {
        operation: 'reference_code',
        factRef: { type: 'category', scope: 'parcel', code: 'NO-EXISTE' },
        code: 'NO-EXISTE',
      },
    ])

    expect(result.errors[0].code).toBe('INVALID_FACT_REF')
  })

  it('J - 1 coincidencia es valida', () => {
    const result = validate(createContract({ parcel: baseParcelFacts() }), [
      {
        operation: 'reference_code',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        code: 'SNRC',
      },
    ])

    expect(result.valid).toBe(true)
  })

  it('K - contrato legacy sin factsByScope rechaza ref scoped aunque el flat coincida', () => {
    const result = validate(createContract(undefined), [
      {
        operation: 'reference_code',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        code: 'SNRC',
      },
    ])

    expect(result.errors[0].code).toBe('INVALID_FACT_REF')
  })

  it('scope solicitado inexistente rechaza sin fallback cruzado', () => {
    const result = validate(createContract({ parcel: baseParcelFacts() }), [
      {
        operation: 'reference_code',
        factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' },
        code: 'SNRC',
      },
    ])

    expect(result.errors[0].code).toBe('INVALID_FACT_REF')
  })

  it('L - semanticCompleteness partial sigue bloqueando state_label', () => {
    const result = validate(createContract({ parcel: baseParcelFacts() }), [
      {
        operation: 'state_label',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRT' },
        label: 'Nucleo rural tradicional',
      },
    ])

    expect(result.errors[0].code).toBe('LABEL_HALLUCINATION')
  })

  it('LABEL_MISMATCH se conserva para semanticCompleteness complete', () => {
    const result = validate(createContract({ parcel: baseParcelFacts() }), [
      {
        operation: 'state_label',
        factRef: { type: 'classification', scope: 'parcel' },
        label: 'Suelo Urbanizable',
      },
    ])

    expect(result.errors[0].code).toBe('LABEL_MISMATCH')
  })

  it('M - automatic no puede convertirse en effective', () => {
    const result = validate(createContract({ parcel: baseParcelFacts() }), [
      {
        operation: 'state_determination',
        factRef: { type: 'classification', scope: 'parcel' },
        determination: 'effective',
      },
    ])

    expect(result.errors[0].code).toBe('DETERMINATION_MISMATCH')
  })

  it('N - conflict no puede convertirse en effective', () => {
    const parcel = baseParcelFacts()
    parcel.classification = {
      code: 'SNR',
      status: 'conflict',
      determination: 'unresolved',
    }
    const result = validate(createContract({ parcel }), [
      {
        operation: 'state_determination',
        factRef: { type: 'classification', scope: 'parcel' },
        determination: 'effective',
      },
    ])

    expect(result.errors[0].code).toBe('DETERMINATION_MISMATCH')
  })

  it('O - affects unresolved no puede convertirse en ausencia', () => {
    const parcel = baseParcelFacts()
    parcel.affects = { status: 'unresolved', items: [] }
    const result = validate(createContract({ parcel }), [
      {
        operation: 'state_absence',
        factRef: { type: 'affects_state', scope: 'parcel' },
      },
    ])

    expect(result.errors[0].code).toBe('UNRESOLVED_AS_ABSENCE')
  })

  it('P - Sada conserva 98.53 como predominio geometrico, no effective', () => {
    const parcel = baseParcelFacts()
    parcel.categories = [
      {
        code: 'SNRC',
        label: 'Nucleo rural comun',
        semanticCompleteness: 'complete',
        status: 'conflict',
        determination: 'unresolved',
        parcelPercentage: 98.53,
      },
      {
        code: 'SNRT',
        label: 'Nucleo rural tradicional',
        semanticCompleteness: 'complete',
        status: 'conflict',
        determination: 'unresolved',
        parcelPercentage: 1.47,
      },
    ]
    const actionArea: FactualScopeFacts = {
      classification: {
        code: 'SNR',
        label: 'Suelo de nucleo rural',
        semanticCompleteness: 'complete',
        status: 'technician_validated',
        determination: 'effective',
      },
      categories: [
        {
          code: 'SNRC',
          label: 'Nucleo rural comun',
          semanticCompleteness: 'complete',
          status: 'technician_validated',
          determination: 'effective',
        },
      ],
    }
    const contract = createContract({ parcel, actionArea })

    expect(
      validate(contract, [
        {
          operation: 'state_geometric_dominance',
          factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        },
      ]).valid
    ).toBe(true)
    expect(
      validate(contract, [
        {
          operation: 'state_determination',
          factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
          determination: 'effective',
        },
      ]).errors[0].code
    ).toBe('DETERMINATION_MISMATCH')
  })

  it.each([
    ['parcel', 'conflict', true],
    ['parcel', 'effective', false],
    ['parcel', 'unresolved', false],
    ['actionArea', 'conflict', true],
    ['actionArea', 'effective', false],
    ['actionArea', 'unresolved', false],
  ] as const)('state_conflict en %s con status %s tiene valid=%s', (scope, status, expectedValid) => {
    const facts: FactualScopeFacts = {
      classification: { code: 'SNR', status, determination: 'automatic' },
    }
    const contract = createContract({ [scope]: facts })
    const result = validate(contract, [
      { operation: 'state_conflict', factRef: { type: 'classification', scope } },
    ])

    expect(result.valid).toBe(expectedValid)
    if (!expectedValid) expect(result.errors[0].code).toBe('STATUS_MISMATCH')
  })

  it.each([
    ['parcel', 'unresolved', true],
    ['parcel', 'effective', false],
    ['parcel', 'conflict', false],
    ['actionArea', 'unresolved', true],
    ['actionArea', 'effective', false],
    ['actionArea', 'conflict', false],
  ] as const)('state_unresolved en %s con status %s tiene valid=%s', (scope, status, expectedValid) => {
    const facts: FactualScopeFacts = {
      classification: { code: 'SNR', status, determination: 'unresolved' },
    }
    const contract = createContract({ [scope]: facts })
    const result = validate(contract, [
      { operation: 'state_unresolved', factRef: { type: 'classification', scope } },
    ])

    expect(result.valid).toBe(expectedValid)
    if (!expectedValid) expect(result.errors[0].code).toBe('STATUS_MISMATCH')
  })

  it('state_conflict con ref inexistente sigue siendo INVALID_FACT_REF', () => {
    const result = validate(createContract({ parcel: baseParcelFacts() }), [
      {
        operation: 'state_conflict',
        factRef: { type: 'category', scope: 'parcel', code: 'INEXISTENTE' },
      },
    ])

    expect(result.errors[0].code).toBe('INVALID_FACT_REF')
  })

  it('state_unresolved con ref ambiguo sigue siendo AMBIGUOUS_FACT_REF', () => {
    const parcel = baseParcelFacts()
    parcel.categories = [
      { code: 'DUP', status: 'unresolved', determination: 'unresolved' },
      { code: 'DUP', status: 'unresolved', determination: 'unresolved' },
    ]
    const result = validate(createContract({ parcel }), [
      {
        operation: 'state_unresolved',
        factRef: { type: 'category', scope: 'parcel', code: 'DUP' },
      },
    ])

    expect(result.errors[0].code).toBe('AMBIGUOUS_FACT_REF')
  })

  it('caso Sada conserva state_conflict valido para SNRC realmente conflict', () => {
    const parcel = baseParcelFacts()
    parcel.categories = [
      {
        code: 'SNRC',
        label: 'Nucleo rural comun',
        semanticCompleteness: 'complete',
        status: 'conflict',
        determination: 'unresolved',
        parcelPercentage: 98.53,
      },
    ]
    const result = validate(createContract({ parcel }), [
      {
        operation: 'state_conflict',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      },
    ])

    expect(result.valid).toBe(true)
  })

  it('Sada rechaza state_unresolved usado para una determination unresolved con status conflict', () => {
    const parcel = baseParcelFacts()
    parcel.categories = [{
      code: 'SNRC',
      label: 'Nucleo rural comun',
      semanticCompleteness: 'complete',
      status: 'conflict',
      determination: 'unresolved',
      parcelPercentage: 98.53,
    }]
    const contract = createContract({ parcel })

    const invalid = validate(contract, [{
      operation: 'state_unresolved',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
    }])
    expect(invalid.valid).toBe(false)
    expect(invalid.errors[0]).toEqual(expect.objectContaining({
      code: 'STATUS_MISMATCH',
      operation: 'state_unresolved',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
    }))

    const corrected = validate(contract, [
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
    expect(corrected.valid).toBe(true)
  })

  it('percentage mismatch y code mismatch se conservan', () => {
    const contract = createContract({ parcel: baseParcelFacts() })

    expect(
      validate(contract, [
        {
          operation: 'state_percentage',
          factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
          percentage: 100,
        },
      ]).errors[0].code
    ).toBe('PERCENTAGE_MISMATCH')
    expect(
      validate(contract, [
        {
          operation: 'reference_code',
          factRef: { type: 'classification', scope: 'parcel' },
          code: 'SNU',
        },
      ]).errors[0].code
    ).toBe('CODE_MISMATCH')
  })

  it('abstention missing_label partial sigue siendo valida', () => {
    const result = validate(
      createContract({ parcel: baseParcelFacts() }),
      [],
      [
        {
          cause: 'missing_label',
          factRef: { type: 'category', scope: 'parcel', code: 'SNRT' },
        },
      ]
    )

    expect(result.valid).toBe(true)
  })

  it('abstention missing_label complete sigue siendo invalida', () => {
    const result = validate(
      createContract({ parcel: baseParcelFacts() }),
      [],
      [
        {
          cause: 'missing_label',
          factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        },
      ]
    )

    expect(result.errors[0].code).toBe('INVALID_ABSTENTION')
  })

  it('abstention con ref ambiguo se rechaza explicitamente', () => {
    const parcel = baseParcelFacts()
    parcel.categories = [parcel.categories![0], { ...parcel.categories![0] }]
    const result = validate(
      createContract({ parcel }),
      [],
      [
        {
          cause: 'missing_label',
          factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        },
      ]
    )

    expect(result.errors[0].code).toBe('AMBIGUOUS_FACT_REF')
  })

  it('unresolved classification sigue sin poder declararse ausencia', () => {
    const parcel = baseParcelFacts()
    parcel.classification = { status: 'unresolved', determination: 'unresolved' }
    const result = validate(createContract({ parcel }), [
      {
        operation: 'state_absence',
        factRef: { type: 'classification', scope: 'parcel' },
      },
    ])

    expect(result.errors[0].code).toBe('UNRESOLVED_AS_ABSENCE')
  })

  it('valida state_coverage exclusivamente contra la cobertura acreditada del fact', () => {
    const parcel = baseParcelFacts()
    parcel.categories = [{
      ...parcel.categories![0], parcelPercentage: undefined, coverage: 'full',
    }]
    const contract = createContract({ parcel })

    expect(validate(contract, [{
      operation: 'state_coverage',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      coverage: 'full',
    }]).valid).toBe(true)
    expect(validate(contract, [{
      operation: 'state_coverage',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      coverage: 'partial',
    }]).errors[0].code).toBe('COVERAGE_MISMATCH')
  })

  it('acepta 100 como representación porcentual de coverage full sin porcentaje sintético', () => {
    const parcel = baseParcelFacts()
    parcel.categories = [{
      ...parcel.categories![0], parcelPercentage: undefined, coverage: 'full',
    }]

    const result = validate(createContract({ parcel }), [{
      operation: 'state_percentage',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      percentage: 100,
    }])

    expect(result.valid).toBe(true)
  })

  it.each([
    ['full', 99],
    ['partial', 100],
    ['unknown', 100],
  ] as const)('rechaza state_percentage %s/%s sin porcentaje explícito compatible', (coverage, percentage) => {
    const parcel = baseParcelFacts()
    parcel.categories = [{
      ...parcel.categories![0], parcelPercentage: undefined, coverage,
    }]

    const result = validate(createContract({ parcel }), [{
      operation: 'state_percentage',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      percentage,
    }])

    expect(result.errors[0].code).toBe('PERCENTAGE_MISMATCH')
  })

  it('mantiene el porcentaje explícito como autoridad aunque coverage sea full', () => {
    const parcel = baseParcelFacts()
    parcel.categories = [{
      ...parcel.categories![0], parcelPercentage: 98.53, coverage: 'full',
    }]
    const contract = createContract({ parcel })

    expect(validate(contract, [{
      operation: 'state_percentage',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      percentage: 98.53,
    }]).valid).toBe(true)
    expect(validate(contract, [{
      operation: 'state_percentage',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      percentage: 100,
    }]).errors[0].code).toBe('PERCENTAGE_MISMATCH')
  })

  it('geometric dominance no permite inventar coverage full', () => {
    const parcel = baseParcelFacts()
    parcel.categories![0].coverage = 'partial'

    expect(validate(createContract({ parcel }), [{
      operation: 'state_coverage',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      coverage: 'full',
    }]).errors[0].code).toBe('COVERAGE_MISMATCH')
  })
})
