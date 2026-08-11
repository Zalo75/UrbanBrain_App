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
  classification?: string
  category?: string
  actionAreaId?: string
  actionAreaSelectionType?: string
  actionAreaValidated: boolean
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

const NORMATIVE_DOCUMENT_TYPES = new Set([
  'ordinance',
  'normative_text',
  'sheet',
])

function isSearchableNormativeDocument(document: PlanningDocumentReference) {
  return !document.documentType || NORMATIVE_DOCUMENT_TYPES.has(document.documentType)
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
  const searchableDocuments = applicableDocuments.filter(isSearchableNormativeDocument)
  const documentNames = unique(searchableDocuments.map(corpusDocumentName))
  const documentIds = unique(searchableDocuments.map((document) => document.id))
  const planningZone = context.planningArea?.value.trim()
  const actionAreaId = context.actionArea?.value.id
  const actionAreaSelectionType = context.actionArea?.value.selectionType
  const actionAreaValidated =
    !context.actionArea || context.actionArea.verification === 'confirmed'
  const actionAreaScope = { actionAreaId, actionAreaSelectionType }
  const classification = context.urbanisticFacts?.classification.value?.code
  const category = context.urbanisticFacts?.category?.value?.code

  if (!municipioCodigo) {
    return {
      municipioCodigo,
      instrumentId,
      ...actionAreaScope,
      actionAreaValidated,
      classification,
      category,
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
      ordinance: context.qualification?.value.trim(),
      planningZone: context.planningArea?.value.trim() || context.qualification?.value.trim(),
      ...actionAreaScope,
      actionAreaValidated,
      classification,
      category,
      source: 'automatic',
      confidence: automaticScopeConfidence(context),
      reason:
        'Se ha localizado la siguiente regulación en las fuentes citadas. La vinculación de esta regulación con la Zona de trabajo todavía no está técnicamente validada; verifica las fuentes antes de emplear el dato en una decisión profesional.',
    }
  }

  if (pendingManualOrdinance) {
    return {
      municipioCodigo,
      instrumentId,
      ...actionAreaScope,
      documentIds: documentIds.length > 0 ? documentIds : undefined,
      documentNames: documentNames.length > 0 ? documentNames : undefined,
      ordinance: undefined,
      planningZone: context.planningArea?.value.trim(),
      actionAreaValidated,
      classification,
      category,
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
      actionAreaValidated,
      classification,
      category,
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
    const hasSearchDescriptor = Boolean(planningZone || classification || category)
    return {
      municipioCodigo,
      instrumentId,
      ...actionAreaScope,
      documentIds,
      documentNames,
      planningZone,
      actionAreaValidated,
      classification,
      category,
      source: 'automatic',
      confidence: automaticScopeConfidence(context),
      reason: hasSearchDescriptor && actionAreaValidated
        ? ''
        : planningZone
        ? `La ordenanza aplicable al ámbito ${planningZone} está pendiente de confirmación técnica.`
        : 'La ordenanza aplicable está pendiente de confirmación técnica.',
    }
  }

  return {
    municipioCodigo,
    instrumentId,
    ...actionAreaScope,
    ordinance: context.qualification?.value.trim(),
    planningZone: planningZone || context.qualification?.value.trim(),
    actionAreaValidated,
    classification,
    category,
    source: technicianValidated ? 'technician_validated' : 'automatic',
    confidence: 'unknown',
    reason: planningZone || context.qualification?.value.trim()
      ? `El ámbito o calificación no está validado y requiere confirmación técnica.`
      : 'No existe una relación trazable entre la parcela y una ordenanza o documento concreto del corpus.',
  }
}

export function canSearchNormativeInformation(scope: NormativeSearchScope) {
  const hasDescriptor = Boolean(
    scope.ordinance || scope.planningZone || scope.classification || scope.category
  )
  const hasDocumentNames = (scope.documentNames?.length ?? 0) > 0

  return Boolean(
    scope.municipioCodigo &&
    hasDescriptor &&
    hasDocumentNames
  )
}

export function canAssertParcelApplicableParameters(scope: NormativeSearchScope) {
  return canSearchNormativeInformation(scope) && scope.actionAreaValidated
}
