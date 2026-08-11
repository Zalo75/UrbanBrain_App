import { describe, expect, it } from 'vitest'

import {
  CORUNA_P1_KNOWLEDGE_VERSION,
  CORUNA_P1_PLANNING_KNOWLEDGE,
  CORUNA_P1_SOURCE_RELEASE_SHA256,
} from './corunaP1PlanningKnowledge'
import {
  getActiveP1PlanningKnowledge,
  getActiveP1PlanningMunicipalities,
} from './PlanningKnowledgeBase'

const EXPECTED_P1_CODES = [
  '15002', '15008', '15009', '15011', '15013', '15014', '15015', '15016',
  '15020', '15021', '15022', '15023', '15025', '15028', '15031', '15038',
  '15042', '15043', '15044', '15045', '15046', '15048', '15049', '15053',
  '15055', '15057', '15061', '15065', '15072', '15076', '15080', '15085',
  '15087', '15093',
]

describe('Planning Knowledge Base P1', () => {
  it('exposes exactly the 34 audited municipalities as active', () => {
    expect(getActiveP1PlanningMunicipalities().map((entry) => entry.municipalityCode)).toEqual(
      EXPECTED_P1_CODES
    )
    expect(CORUNA_P1_PLANNING_KNOWLEDGE).toHaveLength(34)
    expect(
      getActiveP1PlanningMunicipalities().every(
        (entry) => entry.knowledgeVersion === CORUNA_P1_KNOWLEDGE_VERSION
      )
    ).toBe(true)
    expect(CORUNA_P1_SOURCE_RELEASE_SHA256).toMatch(/^[a-f0-9]{64}$/)
    expect(
      getActiveP1PlanningMunicipalities().every(
        (entry) => entry.sourceReleaseSha256 === CORUNA_P1_SOURCE_RELEASE_SHA256
      )
    ).toBe(true)
  })

  it('provides one current instrument and one classification/category layer', () => {
    for (const entry of getActiveP1PlanningMunicipalities()) {
      expect(entry.instrument.officialId).toMatch(/^\d+$/)
      expect(entry.instrument.approvalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.classificationLayer.name).toContain(`_${entry.municipalityCode}_`)
      expect(entry.classificationLayer.name).toContain('_3CLAS_')
      expect(entry.classificationLayer.attributes).toEqual(
        expect.arrayContaining(['cla_homo', 'cat_homo'])
      )
      expect(entry.coverage).toMatchObject({
        classification: true,
        category: true,
        zoneOrOrdinance: false,
        normativeDocument: expect.any(Boolean),
        endToEndParameters: false,
      })
    }
  })

  it('preserves official document types in the generated PlanningDocumentReference catalog', () => {
    const documents = getActiveP1PlanningMunicipalities().flatMap((entry) => entry.documents)

    expect(documents).not.toHaveLength(0)
    expect(documents.every((document) => document.documentType !== undefined)).toBe(true)
    expect(documents.map((document) => document.documentType)).toEqual(
      expect.arrayContaining(['normative_text', 'catalogue', 'other'])
    )
  })

  it('does not activate municipalities outside P1', () => {
    expect(getActiveP1PlanningKnowledge('15030')).toBeUndefined()
    expect(getActiveP1PlanningKnowledge('15075')).toBeUndefined()
    expect(getActiveP1PlanningKnowledge('15058')).toBeUndefined()
    expect(getActiveP1PlanningKnowledge('15034')).toBeUndefined()
    expect(getActiveP1PlanningKnowledge('15050')).toBeUndefined()
  })
})
