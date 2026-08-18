import type {
  ApplicabilityResult,
  NormalizedParcelContext,
  NormativeCandidate,
  NormativeHierarchyLevel,
  ParcelRegimeIdentity,
  ParcelRegimeIdentityScope,
} from '@/domain/parcel-context/types'
import { normalizeComparable } from './normalizeParcelContext'
import { deriveParcelRegimeIdentity } from './parcelRegimeIdentity'

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

export type ParcelQuestionScope = 'independent' | 'regime' | 'mixed'

function isMunicipalDetailedCandidate(candidate: NormativeCandidate) {
  const hierarchy = candidate.hierarchy ?? 'municipal'
  return (
    hierarchy === 'municipal' ||
    hierarchy === 'desarrollo' ||
    hierarchy === 'ordenanza' ||
    hierarchy === 'ficha' ||
    Boolean(candidate.municipalityName)
  )
}

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

const PLAUSIBLE_ORDINANCE_IDENTIFIER = /^(?=.{1,16}$)(?=.*\d)[A-Z0-9]+(?:[._/-][A-Z0-9]+)*$/

function normalizePlausibleOrdinanceIdentifier(value: string | undefined) {
  const normalized = value?.trim().toUpperCase()
  return normalized && PLAUSIBLE_ORDINANCE_IDENTIFIER.test(normalized) ? normalized : undefined
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
  return uniqueNormalized(matches.map((match) => normalizePlausibleOrdinanceIdentifier(match[1])))
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

function isStructuredRegimeCompatible(candidate: NormativeCandidate, expected: string, kind: 'ordinance' | 'planning_area'): boolean | null {
  if (candidate.regimeMetadata) {
    if (candidate.regimeMetadata.kind === kind || candidate.regimeMetadata.kind === 'equivalent') {
      const codeMatches = candidate.regimeMetadata.code && normalizeComparable(candidate.regimeMetadata.code) === normalizeComparable(expected);
      const labelMatches = candidate.regimeMetadata.label && normalizeComparable(candidate.regimeMetadata.label) === normalizeComparable(expected);
      if (codeMatches || labelMatches) return true;
      return false; // Structured metadata exists and does not match!
    } else if (candidate.regimeMetadata.kind === 'general') {
      return true; // General provisions are compatible with anything
    }
    return false;
  }
  return null;
}

function hasCompatiblePlanningArea(candidate: NormativeCandidate, expected: string) {
  const structuredMatch = isStructuredRegimeCompatible(candidate, expected, 'planning_area');
  if (structuredMatch !== null) return structuredMatch;

  const areas = extractPlanningAreas(candidate)
  return areas.length > 0
    ? areas.some((area) => normalizeComparable(area) === normalizeComparable(expected))
    : matchesExpected(candidate, expected)
}

function hasCompatibleOrdinance(candidate: NormativeCandidate, expected: string) {
  const structuredMatch = isStructuredRegimeCompatible(candidate, expected, 'ordinance');
  if (structuredMatch !== null) return structuredMatch;

  const ordinances = extractOrdinances(candidate)
  return ordinances.length > 0
    ? ordinances.some(
        (ordinance) =>
          normalizeOrdinanceIdentifier(ordinance) === normalizeOrdinanceIdentifier(expected)
      )
    : matchesExpected(candidate, expected)
}

function structuredIdentityMatch(
  candidate: NormativeCandidate,
  identity: ParcelRegimeIdentity
): boolean | null {
  const metadata = candidate.regimeMetadata
  if (!metadata) return null
  if (metadata.confidence === 'low') return null
  if (metadata.kind === 'general') return true
  const scopes = identity.scopes.filter((scope) => scope.status === 'effective' || scope.status === 'automatic')
  if (scopes.length === 0) return null

  const matchesScope = (scope: ParcelRegimeIdentityScope) => {
    if (metadata.kind === 'ordinance') {
      const expected = scope.qualification
      return Boolean(expected && (
        normalizeComparable(expected) === normalizeComparable(metadata.code ?? '') ||
        normalizeComparable(expected) === normalizeComparable(metadata.label ?? '')
      ))
    }
    if (metadata.kind === 'planning_area') {
      const expected = scope.planningArea
      return Boolean(expected && (
        normalizeComparable(expected) === normalizeComparable(metadata.code ?? '') ||
        normalizeComparable(expected) === normalizeComparable(metadata.label ?? '')
      ))
    }
    if (metadata.kind === 'land_class') {
      const expected = scope.classification?.code ?? scope.classification?.label
      return Boolean(expected && (
        normalizeComparable(expected) === normalizeComparable(metadata.code ?? '') ||
        normalizeComparable(expected) === normalizeComparable(metadata.label ?? '')
      ))
    }
    return false
  }

  return scopes.some(matchesScope)
}

function normalizeOrdinanceIdentifier(value: string) {
  return normalizeComparable(value).replace(/^ordenanza(?:\s+n(?:umero)?)?\s+/, '')
}

export function requiresDeterminedParcelRegime(question: string): boolean {
  const urbanParameter = /\b(?:clasificaci[oó]n(?:\s+(?:urban[ií]stica|del\s+suelo))?|categor[ií]a\s+del\s+suelo|calificaci[oó]n|ordenanza|par[aá]metros?\s+urban[ií]sticos?|edificabilidad|ocupaci[oó]n|altura|retranqueos?|alineaci[oó]n|parcel[ae]\s+m[ií]nima|frente\s+m[ií]nimo|usos?\s+(?:urban[ií]sticos?|permitidos?|compatibles?|prohibidos?)|condiciones?\s+de\s+cubierta|(?:n[uú]mero\s+de|cu[aá]ntas?)\s+plantas?)\b/i.test(
    question
  )
  const conceptual = /\b(?:qu[eé]\s+(?:es|significa)|definici[oó]n|concepto\s+de)\b/i.test(question)
  const cteTechnicalParameter = /\b(?:altura\s+de\s+evacuaci[oó]n|resistencia\s+al\s+fuego|sector\s+de\s+incendio|recorrido\s+de\s+evacuaci[oó]n)\b/i.test(
    question
  )
  return urbanParameter && !conceptual && !cteTechnicalParameter
}

export function isConditionalViabilityQuestion(question: string): boolean {
  return /\b(?:se\s+puede\s+construir|puedo\s+construir|es\s+edificable|viabilidad\s+urban[ií]stica)\b/i.test(
    question
  )
}

export function classifyParcelQuestionScope(question: string): ParcelQuestionScope {
  const isDocumentaryQuery = /\b(?:qu[eé]\s+(?:normativa|documentos?|fuentes?|regulaci[oó]n)\s+(?:has\s+(?:localizado|encontrado|utilizado)|aparece)|mu[eé]strame\s+la\s+normativa\s+relacionada)\b/i.test(
    question
  )

  if (isDocumentaryQuery) {
    return 'mixed'
  }

  const requiresRegime = requiresDeterminedParcelRegime(question)
  if (!requiresRegime) return 'independent'

  const includesIndependentScope = /\b(?:afecciones?|carreteras?|aguas?|costas?|patrimonio|red\s+natura|planeamiento\s+vigente|documentos?|referencias?\s+catastrales?|catastro|coordenadas?|normativa\s+general|informaci[oó]n\s+territorial|contexto\s+administrativo|tr[aá]mites?\s+administrativos?)\b/i.test(
    question
  )

  return includesIndependentScope ? 'mixed' : 'regime'
}

export function evaluateApplicability(
  context: NormalizedParcelContext,
  candidates: NormativeCandidate[],
  concreteParameterRequested: boolean,
  conditionalViabilityRequested = false
): ApplicabilityResult {
  // Derive from the current normalized fields so callers that enrich the
  // context after normalization cannot accidentally use a stale identity.
  const parcelRegime = deriveParcelRegimeIdentity(context)
  const result: ApplicabilityResult = {
    status: 'NO_DETERMINADO',
    applicable: [],
    review: [],
    rejected: [],
    warnings: [],
    missingData: [],
    conflicts: context.conflicts
      .filter(
        (conflict) =>
          concreteParameterRequested ||
          !['planning', 'landClass', 'qualification', 'planningArea', 'urbanPlanningZone'].includes(
            conflict.field
          )
      )
      .map((conflict) => conflict.reason),
    canAnswerConcreteParameters: false,
    canAnswerGeneralRegime: false,
    canAnswerConditionalViability: false,
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

  const municipalCandidates = candidates.filter(isMunicipalDetailedCandidate)

  if (concreteParameterRequested) {
    const ordinances = uniqueNormalized(municipalCandidates.map((candidate) => candidate.ordinance))
    if (ordinances.length > 1) {
      result.conflicts.push(`La recuperación contiene varias ordenanzas incompatibles: ${ordinances.join(', ')}.`)
    }

    const landClasses = uniqueNormalized(municipalCandidates.flatMap(extractLandClasses))
    if (landClasses.length > 1) {
      result.conflicts.push(`La recuperación mezcla clases de suelo incompatibles: ${landClasses.join(', ')}.`)
    }

    const planningAreas = uniqueNormalized(municipalCandidates.flatMap(extractPlanningAreas))
    if (planningAreas.length > 1) {
      result.conflicts.push(`La recuperación mezcla ámbitos, sectores o fichas incompatibles: ${planningAreas.join(', ')}.`)
    }
  }
  const hasSpecificAreaCandidate = municipalCandidates.some(
    (candidate) => extractPlanningAreas(candidate).length > 0 || candidate.hierarchy === 'ficha'
  )
  const hasUnscopedGeneralCandidate = municipalCandidates.some(
    (candidate) =>
      extractPlanningAreas(candidate).length === 0 &&
      /\b(?:normas?|disposiciones?|ordenanza)\s+generales?\b/i.test(candidateText(candidate))
  )
  if (concreteParameterRequested && hasSpecificAreaCandidate && hasUnscopedGeneralCandidate) {
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
  } else if (conditionalViabilityRequested) {
    if (!expectedLandClass) result.missingData.push('clasificación del suelo')
    if (!expectedQualification && !expectedArea) {
      result.missingData.push('categoría, ordenanza, ámbito o ficha aplicable')
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
    result.missingData.push('MISSING_REGIME_VALIDATION')
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
    let structuredIdentityAccepted = false
    const municipalDetailed = isMunicipalDetailedCandidate(candidate)
    if (municipalDetailed) {
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

    const candidateLandClasses = municipalDetailed ? extractLandClasses(candidate) : []
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

    if (municipalDetailed && concreteParameterRequested) {
      const structuredMatch = structuredIdentityMatch(candidate, parcelRegime)
      if (structuredMatch === false && (parcelRegime.status === 'effective' || parcelRegime.status === 'automatic')) {
        result.rejected.push({ candidate, reason: 'El régimen normativo no coincide con la identidad efectiva de la parcela.' })
        continue
      }
      if (structuredMatch === null && ['review', 'conflict', 'unresolved'].includes(parcelRegime.status)) {
        result.review.push(candidate)
        continue
      }
      structuredIdentityAccepted = structuredMatch === true
    }

    // Low-confidence extracted metadata is useful provenance, but never enough
    // to make a detailed municipal parameter applicable by itself.
    if (
      municipalDetailed &&
      concreteParameterRequested &&
      candidate.regimeMetadata?.confidence === 'low' &&
      (expectedQualification || expectedArea)
    ) {
      result.review.push(candidate)
      continue
    }

    if (
      municipalDetailed &&
      expectedArea &&
      !structuredIdentityAccepted &&
      (candidate.regimeMetadata || extractPlanningAreas(candidate).length > 0) &&
      !hasCompatiblePlanningArea(candidate, expectedArea)
    ) {
      result.rejected.push({ candidate, reason: 'El chunk corresponde a otro ámbito, sector o ficha.' })
      continue
    }

    if (
      municipalDetailed &&
      expectedQualification &&
      !structuredIdentityAccepted &&
      (candidate.regimeMetadata || extractOrdinances(candidate).length > 0) &&
      !hasCompatibleOrdinance(candidate, expectedQualification)
    ) {
      result.rejected.push({ candidate, reason: 'El chunk corresponde a otra ordenanza o calificación.' })
      continue
    }

    if (
      municipalDetailed &&
      concreteParameterRequested &&
      (expectedQualification || expectedArea) &&
      !candidate.regimeMetadata &&
      extractPlanningAreas(candidate).length === 0 &&
      extractOrdinances(candidate).length === 0 &&
      !matchesExpected(candidate, expectedQualification ?? expectedArea!)
    ) {
      result.review.push(candidate)
      continue
    }

    if (
      municipalDetailed &&
      concreteParameterRequested &&
      (expectedQualification || expectedArea) &&
      !candidate.regimeMetadata &&
      !(
        (expectedQualification && hasCompatibleOrdinance(candidate, expectedQualification)) ||
        (expectedArea && hasCompatiblePlanningArea(candidate, expectedArea))
      )
    ) {
      result.review.push(candidate)
      continue
    }

    if ((candidate.hierarchy === 'desarrollo' || candidate.hierarchy === 'ficha') && !candidate.parentInstrument) {
      result.rejected.push({ candidate, reason: 'El documento subordinado no identifica el instrumento superior.' })
      continue
    }

    result.applicable.push(candidate)
  }

  const isTechnicianValidated = context.reliability?.mode === 'technician_validated_manual';
  if (
    isTechnicianValidated &&
    result.missingData.includes('MISSING_REGIME_VALIDATION') &&
    result.applicable.some(c => 
      (expectedQualification && isStructuredRegimeCompatible(c, expectedQualification, 'ordinance') === true) ||
      (expectedArea && isStructuredRegimeCompatible(c, expectedArea, 'planning_area') === true)
    )
  ) {
    result.missingData = result.missingData.filter(d => d !== 'MISSING_REGIME_VALIDATION');
  }

  if (result.conflicts.length > 0) {
    result.status = 'CONFLICTIVO'
    return result
  }

  if (result.applicable.length === 0) {
    result.status = expectedMunicipality ? 'PARCIAL' : 'NO_DETERMINADO'
    return result
  }

  result.canAnswerGeneralRegime = Boolean(expectedLandClass)
  result.canAnswerConditionalViability = Boolean(
    conditionalViabilityRequested && result.canAnswerGeneralRegime
  )

  if (concreteParameterRequested) {
    if (result.missingData.length > 0) {
      result.status = 'PARCIAL'
      return result
    }
    result.status = 'DETERMINADO'
    result.canAnswerConcreteParameters = true
    return result
  }


  if (conditionalViabilityRequested) {
    result.status = result.canAnswerConditionalViability ? 'PARCIAL' : 'NO_DETERMINADO'
    return result
  }

  const finalCompleteParcelRegime = Boolean(
    expectedMunicipality &&
      (context.cadastralReference || context.address || context.coordinates) &&
      expectedLandClass &&
      (expectedQualification || expectedArea) &&
      context.planningInstrument &&
      context.validity &&
      !result.missingData.includes('MISSING_REGIME_VALIDATION')
  )
  result.status = expectedMunicipality ? 'DETERMINADO' : 'PARCIAL'
  result.canAnswerConcreteParameters = result.status === 'DETERMINADO' && finalCompleteParcelRegime
  return result
}
