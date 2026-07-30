import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import type {
  PlanningDocumentReference,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types'

export interface NormativeSearchScope {
  municipioCodigo: string
  instrumentId?: string
  documentIds?: string[]
  documentNames?: string[]
  ordinance?: string
  planningZone?: string
  source: 'automatic' | 'technician_validated'
  confidence: 'confirmed' | 'probable' | 'unknown'
  reason: string
}

interface BuildNormativeSearchScopeInput {
  context: NormalizedParcelContext
  municipioCodigo: string | null
  detected?: {
    manualContext?: {
      ordinance?: string | null
      verification: 'unverified' | 'technician_validated'
    } | null
  } | null
  rawDetection?: unknown
}

function asTerritorialResolution(value: unknown): TerritorialResolution | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<TerritorialResolution>
  return candidate.planning && typeof candidate.planning === 'object'
    ? (candidate as TerritorialResolution)
    : undefined
}

function effectiveResolution(value: unknown) {
  const resolution = asTerritorialResolution(value)
  if (!resolution) return undefined
  return resolution.continuity?.effectiveOfficialContext ?? resolution
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
}

function corpusDocumentName(document: PlanningDocumentReference) {
  if (/\.pdf$/i.test(document.id.trim())) return document.id.trim()
  try {
    const fileName = decodeURIComponent(new URL(document.sourceUrl).pathname.split('/').pop() ?? '')
    return /\.pdf$/i.test(fileName) ? fileName : undefined
  } catch {
    return undefined
  }
}

function currentInstrumentId(resolution: TerritorialResolution | undefined) {
  return resolution?.planning.applicableInstruments?.find(
    (instrument) => instrument.status === 'current'
  )?.id
}

function documentsForInstrument(
  resolution: TerritorialResolution | undefined,
  instrumentId: string | undefined
) {
  const documents = resolution?.planning.documents ?? []
  return instrumentId
    ? documents.filter((document) => !document.instrumentId || document.instrumentId === instrumentId)
    : documents
}

function automaticScopeConfidence(context: NormalizedParcelContext) {
  return context.qualification?.verification === 'confirmed' ||
    context.planningArea?.verification === 'confirmed'
    ? 'confirmed'
    : 'unknown'
}

export function buildNormativeSearchScope({
  context,
  municipioCodigo: trustedMunicipioCodigo,
  detected,
  rawDetection,
}: BuildNormativeSearchScopeInput): NormativeSearchScope {
  const municipioCodigo = trustedMunicipioCodigo ?? ''
  const resolution = effectiveResolution(rawDetection)
  const instrumentId = currentInstrumentId(resolution)
  const documents = documentsForInstrument(resolution, instrumentId)
  const applicableDocuments = documents.filter(
    (document) => document.binding !== 'unverified_for_detected_area'
  )
  const areaSpecificDocuments = applicableDocuments.filter(
    (document) => document.binding === 'area_specific'
  )
  const manualOrdinance = detected?.manualContext?.ordinance?.trim()
  const technicianValidated = Boolean(
    manualOrdinance && detected?.manualContext?.verification === 'technician_validated'
  )
  const automaticOrdinance =
    !manualOrdinance &&
    context.qualification?.source !== 'manual' &&
    context.qualification?.verification === 'confirmed'
      ? context.qualification.value.trim()
      : undefined
  const ordinance = technicianValidated ? manualOrdinance : automaticOrdinance
  const scopedDocuments = ordinance ? applicableDocuments : areaSpecificDocuments
  const documentNames = unique(scopedDocuments.map(corpusDocumentName))
  const documentIds = unique(scopedDocuments.map((document) => document.id))
  const planningZone = context.planningArea?.value.trim()

  if (!municipioCodigo) {
    return {
      municipioCodigo,
      instrumentId,
      source: technicianValidated ? 'technician_validated' : 'automatic',
      confidence: 'unknown',
      reason: 'No existe un código INE municipal oficial para limitar el corpus.',
    }
  }

  if (ordinance && ordinance.length >= 2) {
    return {
      municipioCodigo,
      instrumentId,
      documentIds: documentIds.length > 0 ? documentIds : undefined,
      documentNames: documentNames.length > 0 ? documentNames : undefined,
      ordinance,
      planningZone,
      source: technicianValidated ? 'technician_validated' : 'automatic',
      confidence: technicianValidated
        ? 'confirmed'
        : automaticScopeConfidence(context),
      reason: technicianValidated
        ? 'La ordenanza fue validada por el técnico y limita la recuperación normativa.'
        : 'La ordenanza oficial confirmada limita la recuperación normativa.',
    }
  }

  if (documentNames.length > 0) {
    return {
      municipioCodigo,
      instrumentId,
      documentIds,
      documentNames,
      planningZone,
      source: 'automatic',
      confidence: automaticScopeConfidence(context),
      reason: 'Existe documentación oficial vinculada específicamente al ámbito detectado.',
    }
  }

  return {
    municipioCodigo,
    instrumentId,
    planningZone,
    source: technicianValidated ? 'technician_validated' : 'automatic',
    confidence: 'unknown',
    reason: planningZone
      ? `El ámbito ${planningZone} no está vinculado todavía a una ordenanza o documento concreto del corpus.`
      : 'No existe una relación trazable entre la parcela y una ordenanza o documento concreto del corpus.',
  }
}

export function canSearchConcreteParameters(scope: NormativeSearchScope) {
  return Boolean(
    scope.municipioCodigo &&
      scope.confidence !== 'unknown' &&
      (scope.ordinance || scope.documentNames?.length)
  )
}
