import { describe, expect, it } from 'vitest'

import type { PlanningKnowledgeGenerationInput } from '@/domain/planning-knowledge/types'
import { aCorunaMunicipalities } from '@/shared/territory/provinces/a_coruna'

import {
  CORUNA_PLANNING_KNOWLEDGE_EXCLUSIONS,
  extractDescribeFeatureTypeAttributes,
  generatePlanningKnowledge,
  parsePlanningLayer,
} from './generatePlanningKnowledge'
import {
  activateP1PlanningKnowledge,
  CORUNA_P1_EXPECTED_MUNICIPALITIES,
} from './activateP1PlanningKnowledge'
import { versionPlanningKnowledgePayload } from './versionPlanningKnowledge'

function sourceId(code: string) {
  return `siotuga:wfs-capabilities:${code}`
}

function fixture(): PlanningKnowledgeGenerationInput {
  const municipalityCatalog = aCorunaMunicipalities.map((municipality) => ({
    ineCode: municipality.ineCode!,
    name: municipality.name,
  }))
  const excluded = new Set<string>(CORUNA_PLANNING_KNOWLEDGE_EXCLUSIONS)
  const targets = municipalityCatalog.filter((municipality) => !excluded.has(municipality.ineCode))

  return {
    generatedAt: '2026-07-29T12:00:00.000Z',
    municipalityCatalog,
    excludedMunicipalityCodes: [...CORUNA_PLANNING_KNOWLEDGE_EXCLUSIONS],
    currentPlanningRecords: targets.map((municipality) => ({
      municipalityId: municipality.ineCode,
      municipalityName: municipality.name,
      name: 'Plan general de ordenación municipal',
      approvalDate: '2020-01-31',
      sourceUrl: `https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=${municipality.ineCode}`,
    })),
    municipalitySources: targets.map((municipality, index) => {
      const documentId = String(20_000 + index)
      const layerName = `_${municipality.ineCode}_PXOM_202001_AD_3CLAS_${documentId}`
      const capabilitiesSourceId = sourceId(municipality.ineCode)
      const inventorySourceId = `siotuga:inventory:${municipality.ineCode}:general`
      return {
        municipalityCode: municipality.ineCode,
        capabilitiesSourceId,
        capabilitiesXml: `<WFS_Capabilities><FeatureType><Name>${layerName}</Name></FeatureType></WFS_Capabilities>`,
        inventory: [
          {
            officialId: documentId,
            kind: 'general' as const,
            name: 'Plan general de ordenación municipal',
            figure: 'Plan Xeral de Ordenación Municipal',
            approvalDate: '2020-01-31',
            sourceId: inventorySourceId,
          },
        ],
        layerSchemas: {
          [layerName]: {
            sourceId: `siotuga:wfs-schema:${municipality.ineCode}:${layerName}`,
            xml: '<schema><element name="cla_homo"/><element name="cat_homo"/></schema>',
          },
        },
        sourceIds: [capabilitiesSourceId, inventorySourceId],
      }
    }),
    rawSources: targets.flatMap((municipality) => [
      {
        id: sourceId(municipality.ineCode),
        provider: 'siotuga' as const,
        url: `https://siotuga.xunta.gal/siotuga/ws?codine=${municipality.ineCode}`,
        retrievedAt: '2026-07-29T12:00:00.000Z',
        mediaType: 'application/xml',
        content: `<WFS_Capabilities>${municipality.ineCode}</WFS_Capabilities>`,
      },
      {
        id: `siotuga:inventory:${municipality.ineCode}:general`,
        provider: 'siotuga' as const,
        url: `https://siotuga.xunta.gal/siotuga/assets/inventario/query_document.php#municipality=${municipality.ineCode}&class=14`,
        retrievedAt: '2026-07-29T12:00:00.000Z',
        mediaType: 'application/json',
        content: '[]',
      },
    ]),
  }
}

describe('Planning Knowledge Base generator', () => {
  it('generates the 91-municipality draft without activating any municipality', () => {
    const release = generatePlanningKnowledge(fixture())

    expect(release.validation.status).toBe('draft')
    expect(release.municipalities).toHaveLength(91)
    expect(release.municipalities.every((municipality) => municipality.activation.status === 'inactive')).toBe(true)
    expect(release.municipalities.every((municipality) => municipality.technicalPattern === 'single_current_layer')).toBe(true)
    expect(release.municipalities[0]?.layers[0]?.attributes).toEqual(['cat_homo', 'cla_homo'])
  })

  it('does not select a newer general layer when it is not the officially current instrument', () => {
    const input = fixture()
    const municipality = input.municipalitySources[0]!
    const oldLayer = municipality.capabilitiesXml.match(/<Name>([^<]+)/)?.[1]
    const newerLayer = `_${municipality.municipalityCode}_PXOM_202501_AD_3CLAS_99999`
    municipality.capabilitiesXml = municipality.capabilitiesXml.replace(
      '</WFS_Capabilities>',
      `<FeatureType><Name>${newerLayer}</Name></FeatureType></WFS_Capabilities>`
    )
    municipality.inventory.push({
      officialId: '99999',
      kind: 'general',
      name: 'Instrument awaiting legal reconciliation',
      figure: 'Plan Xeral de Ordenación Municipal',
      approvalDate: '2025-01-01',
      sourceId: `siotuga:inventory:${municipality.municipalityCode}:general`,
    })

    const release = generatePlanningKnowledge(input)
    const generated = release.municipalities[0]!

    expect(generated.technicalPattern).toBe('multiple_general_versions')
    expect(generated.currentInstrumentCandidates).toEqual([
      parsePlanningLayer(oldLayer!, municipality.capabilitiesSourceId).officialDocumentId,
    ])
    expect(generated.activation.status).toBe('inactive')
  })

  it('marks composition as ambiguous and never activates it', () => {
    const input = fixture()
    const municipality = input.municipalitySources[0]!
    municipality.capabilitiesXml = municipality.capabilitiesXml.replace(
      '</WFS_Capabilities>',
      '<FeatureType><Name>_15001_MP_202401_AD_3CLAS_99998</Name></FeatureType></WFS_Capabilities>'
    )
    municipality.inventory.push({
      officialId: '99998',
      kind: 'general',
      name: 'Modificación puntual',
      figure: 'Modificación Puntual',
      approvalDate: '2024-01-01',
      sourceId: 'siotuga:inventory:15001:general',
    })

    const generated = generatePlanningKnowledge(input).municipalities[0]!

    expect(generated.technicalPattern).toBe('instrument_composition_required')
    expect(generated.validation).toEqual({
      status: 'ambiguous',
      reasons: ['instrument_composition_not_validated'],
    })
    expect(generated.activation.status).toBe('inactive')
  })

  it('blocks a structurally incomplete provincial acquisition', () => {
    const input = fixture()
    const removedCode = input.municipalitySources.pop()!.municipalityCode

    const release = generatePlanningKnowledge(input)

    expect(release.validation.status).toBe('blocked')
    expect(release.validation.errors).toContain(`${removedCode}:missing_municipality_sources`)
    expect(
      release.municipalities.find(
        (municipality) => municipality.municipalityCode === removedCode
      )?.activation.status
    ).toBe('inactive')
  })

  it('preserves malformed layers as inactive evidence', () => {
    const layer = parsePlanningLayer(
      '_15074___AD_3CLAS_',
      'siotuga:wfs-capabilities:15074'
    )

    expect(layer).toMatchObject({
      name: '_15074___AD_3CLAS_',
      kind: 'classification',
      parseStatus: 'malformed',
    })
  })

  it('extracts the official schema without treating the feature type as an attribute', () => {
    expect(
      extractDescribeFeatureTypeAttributes(
        '<schema><element name="layer_name"><complexType/><element name="cla_homo"/><element name="cat_homo"/></schema>',
        'layer_name'
      )
    ).toEqual(['cat_homo', 'cla_homo'])
  })

  it('activates exactly 34 P1 municipalities without normative or parametric coverage', () => {
    const draft = generatePlanningKnowledge(fixture())
    const p1Draft = versionPlanningKnowledgePayload({
      schemaVersion: draft.schemaVersion,
      scope: draft.scope,
      generatedAt: draft.generatedAt,
      sources: draft.sources,
      municipalities: draft.municipalities.map((municipality, index) =>
        index < CORUNA_P1_EXPECTED_MUNICIPALITIES
          ? municipality
          : { ...municipality, technicalPattern: 'multiple_general_versions' as const }
      ),
      validation: draft.validation,
    })

    const release = activateP1PlanningKnowledge(p1Draft)
    const active = release.municipalities.filter(
      (municipality) => municipality.activation.status === 'active'
    )

    expect(release.validation.status).toBe('ready_for_review')
    expect(active).toHaveLength(34)
    expect(active.every((municipality) => municipality.coverage.classification)).toBe(true)
    expect(active.every((municipality) => municipality.coverage.category)).toBe(true)
    expect(active.every((municipality) => !municipality.coverage.normativeDocument)).toBe(true)
    expect(active.every((municipality) => !municipality.coverage.endToEndParameters)).toBe(true)
  })

  it('fails closed and activates none when the P1 candidate count is not exactly 34', () => {
    const draft = generatePlanningKnowledge(fixture())
    const release = activateP1PlanningKnowledge(draft)

    expect(release.validation.status).toBe('blocked')
    expect(release.validation.errors).toContain(
      'p1_expected_34_municipalities_received_91'
    )
    expect(
      release.municipalities.every(
        (municipality) => municipality.activation.status === 'inactive'
      )
    ).toBe(true)
  })

  it('normalizes Oza-Cesuras as one current municipality with two inherited spatial regimes', () => {
    const input = fixture()
    const code = '15902'
    input.currentPlanningRecords = input.currentPlanningRecords.filter(
      (record) => record.municipalityId !== code
    )
    input.currentPlanningRecords.push(
      {
        municipalityId: code,
        municipalityName: 'Oza-Cesuras',
        name: 'Plan general de ordenación municipal',
        approvalDate: '2001-10-29',
        sourceUrl: `https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=${code}`,
      },
      {
        municipalityId: code,
        municipalityName: 'Oza-Cesuras',
        name: 'Normas subsidiarias de planeamiento',
        approvalDate: '1997-03-03',
        sourceUrl: `https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=${code}`,
      }
    )
    const source = input.municipalitySources.find(
      (municipality) => municipality.municipalityCode === code
    )!
    const pxomLayer = '_15902_PXOM_200110_AD_3CLAS_22459'
    const nnssLayer = '_15902_NNSSPP_199703_AD_3CLAS_22287'
    source.capabilitiesXml = `<WFS_Capabilities><FeatureType><Name>${pxomLayer}</Name></FeatureType><FeatureType><Name>${nnssLayer}</Name></FeatureType></WFS_Capabilities>`
    source.inventory = [
      {
        officialId: '22459',
        kind: 'general',
        name: 'Plan general de ordenación municipal',
        figure: 'Plan Xeral de Ordenación Municipal',
        approvalDate: '2001-10-29',
        sourceId: `siotuga:inventory:${code}:general`,
      },
      {
        officialId: '22287',
        kind: 'general',
        name: 'Normas subsidiarias de planeamiento',
        figure: 'Normas Subsidiarias de Planeamento',
        approvalDate: '1997-03-03',
        sourceId: `siotuga:inventory:${code}:general`,
      },
    ]
    source.layerSchemas = Object.fromEntries(
      [pxomLayer, nnssLayer].map((layerName) => [
        layerName,
        {
          sourceId: `siotuga:wfs-schema:${code}:${layerName}`,
          xml: '<schema><element name="cla_homo"/><element name="cat_homo"/></schema>',
        },
      ])
    )

    const municipality = generatePlanningKnowledge(input).municipalities.find(
      (candidate) => candidate.municipalityCode === code
    )!

    expect(municipality.municipalityName).toBe('Oza-Cesuras')
    expect(municipality.technicalPattern).toBe('municipal_succession_scoped')
    expect(municipality.activation.status).toBe('inactive')
    expect(municipality.currentInstrumentCandidates).toEqual(['22287', '22459'])
    expect(municipality.currentPlanning).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ predecessorMunicipalityCode: '15063' }),
        expect.objectContaining({ predecessorMunicipalityCode: '15026' }),
      ])
    )
    expect(municipality.territorialScopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          municipalityCode: '15902',
          predecessorMunicipalityCode: '15063',
          instrumentId: '22459',
          layerName: pxomLayer,
          description: expect.stringContaining('Oza dos Ríos'),
        }),
        expect.objectContaining({
          municipalityCode: '15902',
          predecessorMunicipalityCode: '15026',
          instrumentId: '22287',
          layerName: nnssLayer,
          description: expect.stringContaining('Cesuras'),
        }),
      ])
    )
    expect(new Set(municipality.territorialScopes.map((scope) => scope.layerName)).size).toBe(2)
    expect(municipality.validation).toEqual({
      status: 'candidate',
      reasons: ['municipal_succession_requires_spatial_scope_resolution'],
    })
    expect(municipality.coverage.classification).toBe(false)
    expect(municipality.coverage.endToEndParameters).toBe(false)
    expect(
      generatePlanningKnowledge(input).municipalities.some((candidate) =>
        ['15026', '15063'].includes(candidate.municipalityCode)
      )
    ).toBe(false)
  })
})
