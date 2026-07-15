import type {
  ApplicabilityResult,
  NormalizedParcelContext,
  NormativeCandidate,
  NormativeHierarchyLevel,
} from '@/domain/parcel-context/types'
import { normalizeComparable } from './normalizeParcelContext'

const HISTORICAL_PATTERN = /\b(?:derogad[oa]|hist[oó]ric[oa]|no\s+vigente|sustituid[oa])\b/i

const LAND_CLASSES: Array<[RegExp, string]> = [
  [/suelo\s+urbano\s+no\s+consolidado/i, 'urbano_no_consolidado'],
  [/suelo\s+urbano\s+consolidado/i, 'urbano_consolidado'],
  [/suelo\s+urbanizable/i, 'urbanizable'],
  [/(?:suelo\s+r[uú]stico|suelo\s+no\s+urbanizable)/i, 'rustico_no_urbanizable'],
  [/n[uú]cleo\s+rural/i, 'nucleo_rural'],
]

export const NORMATIVE_HIERARCHY: NormativeHierarchyLevel[] = [
  'estatal',
  'autonomico',
  'municipal',
  'desarrollo',
  'ordenanza',
  'ficha',
  'sectorial',
]

function candidateText(candidate: NormativeCandidate) {
  return [candidate.documentName, candidate.title, candidate.content].filter(Boolean).join('\n')
}

function uniqueNormalized(values: Array<string | null | undefined>) {
  const map = new Map<string, string>()
  for (const value of values) {
    if (!value?.trim()) continue
    map.set(normalizeComparable(value), value.trim())
  }
  return [...map.values()]
}

function extractOrdinances(candidate: NormativeCandidate): string[] {
  if (candidate.ordinance?.trim()) return [candidate.ordinance.trim()]
  const metadataText = [candidate.documentName, candidate.title].filter(Boolean).join('\n')
  const metadataMatches = [...metadataText.matchAll(
    /\bordenanza\s+(?:n(?:[ºo°.]|umero)?\s*)?([A-Z0-9][A-Z0-9._/-]{0,15})\b/gi
  )]
  const matches = metadataMatches.length > 0
    ? metadataMatches
    : [...candidate.content.matchAll(
        /\bordenanza\s+(?:n(?:[ºo°.]|umero)?\s*)?([A-Z0-9][A-Z0-9._/-]{0,15})\b/gi
      )]
  return uniqueNormalized(matches.map((match) => match[1]))
}

function extractLandClasses(candidate: NormativeCandidate): string[] {
  if (candidate.landClass?.trim()) return [candidate.landClass.trim()]
  const text = candidateText(candidate)
  return LAND_CLASSES.filter(([pattern]) => pattern.test(text)).map(([, value]) => value)
}

function extractPlanningAreas(candidate: NormativeCandidate): string[] {
  if (candidate.planningArea?.trim()) return [candidate.planningArea.trim()]
  const metadataText = [candidate.documentName, candidate.title].filter(Boolean).join('\n')
  const metadataMatches = [...metadataText.matchAll(
    /\b(?:sector|[aá]mbito|ficha)\s+(?:n(?:[ºo°.]|umero)?\s*)?([A-Z0-9][A-Z0-9._/-]{0,15})\b/gi
  )]
  const matches = metadataMatches.length > 0
    ? metadataMatches
    : [...candidate.content.matchAll(
        /\b(?:sector|[aá]mbito|ficha)\s+(?:n(?:[ºo°.]|umero)?\s*)?([A-Z0-9][A-Z0-9._/-]{0,15})\b/gi
      )]
  return uniqueNormalized(matches.map((match) => match[1]))
}

function isHistorical(candidate: NormativeCandidate) {
  const explicitStatus = normalizeComparable(candidate.status ?? '')
  const documentMetadata = [candidate.documentName, candidate.title].filter(Boolean).join(' ')
  return explicitStatus === 'derogada' || explicitStatus === 'historico' || HISTORICAL_PATTERN.test(documentMetadata)
}

function normalizeMunicipality(value: string) {
  return normalizeComparable(value).replace(/^(?:a|o)\s+/, '')
}

function matchesExpected(candidate: NormativeCandidate, expected: string) {
  const normalizedExpected = normalizeComparable(expected)
  return normalizeComparable(candidateText(candidate)).includes(normalizedExpected)
}

export function requiresDeterminedParcelRegime(question: string): boolean {
  const urbanParameter = /\b(?:edificabilidad|ocupaci[oó]n|altura|retranqueos?|alineaci[oó]n|parcel[ae]\s+m[ií]nima|frente\s+m[ií]nimo|usos?\s+(?:permitidos?|compatibles?|prohibidos?)|condiciones?\s+de\s+cubierta|n[uú]mero\s+de\s+plantas?)\b/i.test(
    question
  )
  const conceptual = /\b(?:qu[eé]\s+(?:es|significa)|definici[oó]n|concepto\s+de)\b/i.test(question)
  const cteTechnicalParameter = /\b(?:altura\s+de\s+evacuaci[oó]n|resistencia\s+al\s+fuego|sector\s+de\s+incendio|recorrido\s+de\s+evacuaci[oó]n)\b/i.test(
    question
  )
  return urbanParameter && !conceptual && !cteTechnicalParameter
}

export function evaluateApplicability(
  context: NormalizedParcelContext,
  candidates: NormativeCandidate[],
  concreteParameterRequested: boolean
): ApplicabilityResult {
  const result: ApplicabilityResult = {
    status: 'NO_DETERMINADO',
    applicable: [],
    rejected: [],
    warnings: [],
    missingData: [],
    conflicts: context.conflicts.map((conflict) => conflict.reason),
    canAnswerConcreteParameters: false,
  }

  const municipalityMap = new Map<string, string>()
  for (const municipalityName of candidates.map((candidate) => candidate.municipalityName)) {
    if (municipalityName?.trim()) {
      municipalityMap.set(normalizeMunicipality(municipalityName), municipalityName.trim())
    }
  }
  const municipalityNames = [...municipalityMap.values()]
  if (municipalityNames.length > 1) {
    result.conflicts.push(`La recuperación contiene varios municipios incompatibles: ${municipalityNames.join(', ')}.`)
  }

  const ordinances = uniqueNormalized(candidates.flatMap(extractOrdinances))
  if (ordinances.length > 1) {
    result.conflicts.push(`La recuperación contiene varias ordenanzas incompatibles: ${ordinances.join(', ')}.`)
  }

  const landClasses = uniqueNormalized(candidates.flatMap(extractLandClasses))
  if (landClasses.length > 1) {
    result.conflicts.push(`La recuperación mezcla clases de suelo incompatibles: ${landClasses.join(', ')}.`)
  }

  const planningAreas = uniqueNormalized(candidates.flatMap(extractPlanningAreas))
  if (planningAreas.length > 1) {
    result.conflicts.push(`La recuperación mezcla ámbitos, sectores o fichas incompatibles: ${planningAreas.join(', ')}.`)
  }
  const hasSpecificAreaCandidate = candidates.some(
    (candidate) => extractPlanningAreas(candidate).length > 0 || candidate.hierarchy === 'ficha'
  )
  const hasUnscopedGeneralCandidate = candidates.some(
    (candidate) =>
      extractPlanningAreas(candidate).length === 0 &&
      /\b(?:normas?|disposiciones?|ordenanza)\s+generales?\b/i.test(candidateText(candidate))
  )
  if (hasSpecificAreaCandidate && hasUnscopedGeneralCandidate) {
    result.conflicts.push(
      'La recuperación mezcla regulación general con una ficha o ámbito particular sin demostrar su relación jerárquica.'
    )
  }

  const historicalCount = candidates.filter(isHistorical).length
  if (historicalCount > 0 && historicalCount < candidates.length) {
    result.conflicts.push('La recuperación mezcla documentos históricos o derogados con documentos aparentemente vigentes.')
  }

  const expectedMunicipality = context.municipality?.value.name
  const expectedLandClass = context.landClass?.value
  const expectedQualification = context.qualification?.value
  const expectedArea = context.planningArea?.value

  if (!expectedMunicipality) result.missingData.push('municipio')
  if (!context.cadastralReference && !context.address && !context.coordinates) {
    result.missingData.push('referencia catastral, dirección o coordenadas')
  }
  if (concreteParameterRequested) {
    if (!expectedLandClass) result.missingData.push('clasificación del suelo')
    if (!expectedQualification && !expectedArea) {
      result.missingData.push('calificación, ordenanza, ámbito o ficha')
    }
    if (!context.planningInstrument) result.missingData.push('instrumento de planeamiento')
    if (!context.validity) result.missingData.push('vigencia del instrumento')
  }

  const determiningZone = context.qualification ?? context.planningArea
  const requiredFieldsAreConfirmed = Boolean(
    context.canAnswerConcreteParameters &&
    context.municipality?.verification === 'confirmed' &&
      context.landClass?.verification === 'confirmed' &&
      determiningZone?.verification === 'confirmed' &&
      context.planningInstrument?.verification === 'confirmed' &&
      context.validity?.verification === 'confirmed'
  )
  if (concreteParameterRequested && result.missingData.length === 0 && !requiredFieldsAreConfirmed) {
    result.missingData.push('confirmación técnica del régimen urbanístico aplicable')
  }

  const hasCompleteParcelRegime = Boolean(
    expectedMunicipality &&
      (context.cadastralReference || context.address || context.coordinates) &&
      expectedLandClass &&
      (expectedQualification || expectedArea) &&
      context.planningInstrument &&
      context.validity &&
      requiredFieldsAreConfirmed
  )

  for (const candidate of candidates) {
    if (candidate.hierarchy === 'municipal' || candidate.municipalityName) {
      if (!candidate.municipalityName) {
        result.rejected.push({ candidate, reason: 'El chunk municipal no identifica su municipio.' })
        continue
      }
      if (
        expectedMunicipality &&
        normalizeMunicipality(candidate.municipalityName) !== normalizeMunicipality(expectedMunicipality)
      ) {
        result.rejected.push({ candidate, reason: 'El chunk pertenece a otro municipio.' })
        continue
      }
    }

    if (isHistorical(candidate)) {
      result.rejected.push({ candidate, reason: 'El documento es histórico, derogado o no vigente.' })
      continue
    }

    const candidateLandClasses = extractLandClasses(candidate)
    if (
      expectedLandClass &&
      candidateLandClasses.length > 0 &&
      !candidateLandClasses.some(
        (landClass) => normalizeComparable(landClass) === normalizeComparable(expectedLandClass)
      )
    ) {
      result.rejected.push({ candidate, reason: 'El chunk corresponde a una clase de suelo incompatible.' })
      continue
    }

    if (expectedArea && extractPlanningAreas(candidate).length > 0 && !matchesExpected(candidate, expectedArea)) {
      result.rejected.push({ candidate, reason: 'El chunk corresponde a otro ámbito, sector o ficha.' })
      continue
    }

    if (expectedQualification && extractOrdinances(candidate).length > 0 && !matchesExpected(candidate, expectedQualification)) {
      result.rejected.push({ candidate, reason: 'El chunk corresponde a otra ordenanza o calificación.' })
      continue
    }

    if (
      concreteParameterRequested &&
      (expectedQualification || expectedArea) &&
      !matchesExpected(candidate, expectedQualification ?? expectedArea!)
    ) {
      result.rejected.push({
        candidate,
        reason: 'No existe relación demostrable entre el parámetro recuperado y la ordenanza o ámbito de la parcela.',
      })
      continue
    }

    if ((candidate.hierarchy === 'desarrollo' || candidate.hierarchy === 'ficha') && !candidate.parentInstrument) {
      result.rejected.push({ candidate, reason: 'El documento subordinado no identifica el instrumento superior.' })
      continue
    }

    result.applicable.push(candidate)
  }

  if (result.conflicts.length > 0) {
    result.status = 'CONFLICTIVO'
    return result
  }

  if (result.applicable.length === 0) {
    result.status = expectedMunicipality ? 'PARCIAL' : 'NO_DETERMINADO'
    return result
  }

  if (concreteParameterRequested) {
    if (result.missingData.length > 0) {
      result.status = 'PARCIAL'
      return result
    }
    result.status = 'DETERMINADO'
    result.canAnswerConcreteParameters = true
    return result
  }

  result.status = expectedMunicipality ? 'DETERMINADO' : 'PARCIAL'
  result.canAnswerConcreteParameters = result.status === 'DETERMINADO' && hasCompleteParcelRegime
  return result
}
