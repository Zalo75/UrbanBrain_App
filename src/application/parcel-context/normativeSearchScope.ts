import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import type {
  ContextDetermination,
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
  actionAreaId?: string
  actionAreaSelectionType?: string
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
      ordinanceDetermination?: {
        technician?: ContextDetermination<string>
      }
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
  const legacyManualOrdinance = detected?.manualContext?.ordinance?.trim()
  const ordinanceDetermination = detected?.manualContext?.ordinanceDetermination?.technician
  const manualOrdinance = ordinanceDetermination?.value.trim() || legacyManualOrdinance
  const technicianValidated = Boolean(
    manualOrdinance &&
      (ordinanceDetermination?.verification === 'technician_validated' ||
        (!ordinanceDetermination &&
          detected?.manualContext?.verification === 'technician_validated'))
  )
  const pendingManualOrdinance = Boolean(manualOrdinance && !technicianValidated)
  const automaticOrdinance =
    !manualOrdinance &&
    context.qualification?.source !== 'manual' &&
    context.qualification?.verification === 'confirmed'
      ? context.qualification.value.trim()
      : undefined
  const ordinance = technicianValidated ? manualOrdinance : automaticOrdinance
  // La PKB ya ha vinculado estos documentos al identificador estable del
  // instrumento seleccionado. Delimitan el universo de búsqueda, pero no
  // prueban por sí solos un parámetro urbanístico concreto.
  const scopedDocuments = applicableDocuments
  const documentNames = unique(scopedDocuments.map(corpusDocumentName))
  const documentIds = unique(scopedDocuments.map((document) => document.id))
  const planningZone = context.planningArea?.value.trim()
  const actionAreaId = context.actionArea?.value.id
  const actionAreaSelectionType = context.actionArea?.value.selectionType
  const actionAreaValidated =
    !context.actionArea || context.actionArea.verification === 'confirmed'
  const actionAreaScope = { actionAreaId, actionAreaSelectionType }

  if (!municipioCodigo) {
    return {
      municipioCodigo,
      instrumentId,
      ...actionAreaScope,
      source: technicianValidated ? 'technician_validated' : 'automatic',
      confidence: 'unknown',
      reason: 'No existe un código INE municipal oficial para limitar el corpus.',
    }
  }

  if (!actionAreaValidated) {
    return {
      municipioCodigo,
      instrumentId,
      documentIds: documentIds.length > 0 ? documentIds : undefined,
      documentNames: documentNames.length > 0 ? documentNames : undefined,
      planningZone,
      ...actionAreaScope,
      source: 'automatic',
      confidence: 'unknown',
      reason:
        'El área de actuación seleccionada sigue pendiente de validación técnica y no puede habilitar parámetros urbanísticos concretos.',
    }
  }

  if (pendingManualOrdinance) {
    return {
      municipioCodigo,
      instrumentId,
      ...actionAreaScope,
      documentIds: documentIds.length > 0 ? documentIds : undefined,
      documentNames: documentNames.length > 0 ? documentNames : undefined,
      planningZone,
      source: 'automatic',
      confidence: 'unknown',
      reason:
        'La ordenanza seleccionada manualmente sigue pendiente de validación técnica y no puede habilitar parámetros urbanísticos concretos.',
    }
  }

  if (ordinance) {
    return {
      municipioCodigo,
      instrumentId,
      ...actionAreaScope,
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
      ...actionAreaScope,
      documentIds,
      documentNames,
      planningZone,
      source: 'automatic',
      confidence: automaticScopeConfidence(context),
      reason: planningZone
        ? `La ordenanza aplicable al ámbito ${planningZone} está pendiente de confirmación técnica.`
        : 'La ordenanza aplicable está pendiente de confirmación técnica.',
    }
  }

  return {
    municipioCodigo,
    instrumentId,
    ...actionAreaScope,
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
      scope.ordinance
  )
}
