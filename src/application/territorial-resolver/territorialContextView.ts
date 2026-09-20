import { detectionSummary } from '@/application/parcel-context/detectionSummary'
import type { TerritorialDetectionSummary } from '@/application/parcel-context/normalizeParcelContext'
import type { ParcelAccounting } from '@/domain/territorial-resolver/parcelAccounting'
import type {
  ActionAreaSelection,
  ClassificationResolution,
  ContextDetermination,
  OfficialResourceLink,
  PlanningDocumentReference,
  TerritorialEvidence,
  ManualTerritorialContext,
  OfficialSourceCheck,
  TerritorialResolution,
  UrbanisticRegimeFacts,
  TerritorialResourceCatalog,
  ContextDeterminationState,
  OrdinanceProductStatus,
  OrdinanceReviewMaterial,
  OrdinanceCandidate,
} from '@/domain/territorial-resolver/types';
import { urbanisticFactsFromClassificationResolution } from '@/domain/territorial-resolver/urbanisticFacts';
import { officialResourceLinks } from '@/application/territorial-resolver/officialResourceLinks';
import {
  allSourceChecks,
  officialContextForUse,
} from '@/application/territorial-resolver/territorialContinuity';
import {
  applyManualAffectDecisions,
  applyManualFactDecisions,
  territorialAffectKey,
} from '@/application/territorial-resolver/manualTerritorialContext';
import { applyActionAreaToUrbanisticFacts } from '@/application/territorial-resolver/actionAreaSelection';
import { createAutomaticDetermination } from '@/domain/territorial-resolver/determinations';
import { getInstrumentIdentityOptions } from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase';
import { runtimeCatalogStatus } from '@/domain/planning-knowledge/identityCatalog';

export interface TerritorialContextView {
  coverage?: ParcelAccounting;
  status: 'confirmed' | 'approximate' | 'provisional' | 'conflict' | 'undetermined';
  confidence: TerritorialResolution['confidence'];
  resolvedAt: string;
  inputMethod: TerritorialResolution['inputMethod'];
  cadastralReference?: string;
  parcelReference?: string;
  address?: string;
  coordinates?: TerritorialResolution['coordinates'];
  parcelGeometry?: TerritorialResolution['parcelGeometry'];
  parcelSurfaceSquareMetres?: number;
  actionArea?: ActionAreaSelection;
  municipality?: string;
  municipalityCode?: string;
  province?: string;
  classification?: TerritorialResolution['planning']['classification'];
  classificationOrigin?: 'automatic' | 'manual';
  automaticClassification?: TerritorialResolution['planning']['classification'];
  classificationResolution?: ClassificationResolution;
  urbanisticFacts?: UrbanisticRegimeFacts;
  officialLinks?: OfficialResourceLink[];
  planningDocuments?: PlanningDocumentReference[];
  resources?: TerritorialResourceCatalog;
  planningStatus?: 'determined' | 'conflict' | 'not_determined' | 'partial';
  ordinanceDetermination?: ContextDeterminationState<string> & { candidates?: OrdinanceCandidate[]; status?: string };
  /** Detailed zoning candidates, including multizone/review-required evidence. */
  ordinanceCandidates?: Array<{
    identity: string;
    semanticDimension?: string;
    coverage?: { percentage?: number; areaSquareMetres?: number; method?: string };
    confidence?: string;
    sourceRef?: string;
    sourceDocument?: string;
    graphicEvidence?: string;
    legendEvidence?: string;
    documentaryEvidence?: string;
    provenance: string[];
    alignmentMethod?: string;
    estimatedErrorMeters?: number;
    warning?: string;
    identityId?: string;
    catalogStatus?: 'ACCEPTED' | 'REVIEW_REQUIRED' | 'REJECTED';
    normativeReferences?: Array<{ documentId: string; chunkIds: string[]; article?: string; relation: 'defines' | 'regulates' | 'mentions'; sourceId: string }>;
  }>;
  ordinanceCatalogOptions?: Array<{
    identityId: string;
    code: string;
    label: string;
    status: 'ACCEPTED' | 'REVIEW_REQUIRED' | 'REJECTED';
    semanticDimension: string;
  }>;
  contextualCandidates?: Array<{
    identity: string;
    semanticDimension?: string;
    confidence?: string;
    sourceRef?: string;
    provenance: string[];
  }>;
  ordinanceResolution?: {
    status: OrdinanceProductStatus;
    identity?: { code?: string; label?: string };
    confidence?: string;
    source?: string;
    provenance: string[];
    alignmentMethod?: string;
    estimatedErrorMeters?: number;
    warning?: string;
    reviewMaterials?: OrdinanceReviewMaterial;
    confirmationSource?: 'automatic' | 'user';
    confirmedByUser?: boolean;
    identityId?: string;
    normativeReferences?: Array<{ documentId: string; chunkIds: string[]; article?: string; relation: 'defines' | 'regulates' | 'mentions'; sourceId: string }>;
    hasEligibility?: any;
  };
  areas: string[];
  instrument?: string;
  affects: Array<{
    key?: string;
    category: string;
    name: string;
    confidence: string;
    origin?: 'automatic' | 'manual';
  }>;
  automaticAffects?: Array<{
    key: string;
    category: string;
    name: string;
    confidence: string;
    source: string;
  }>;
  parcelAffects?: Array<{
    key: string;
    category: string;
    name: string;
    confidence: string;
    source: string;
  }>;
  conflicts: string[];
  parcelConflicts?: string[];
  warnings: string[];
  sources: TerritorialEvidence[];
  canAnswerConcreteParameters: boolean;
  canRuleOutUndetectedAffects: false;
  candidateCount: number;
  latestAttemptAt: string;
  officialContextResolvedAt?: string;
  usingPreviousOfficialContext: boolean;
  manualContext?: Omit<ManualTerritorialContext, 'validatedBy'>;
  manualOrdinance?: Omit<ContextDetermination<string>, 'recordedBy' | 'validatedBy'>;
  technicallyReviewed: boolean;
  sourceChecks: OfficialSourceCheck[];
}

function isTerritorialResolution(value: unknown): value is TerritorialResolution {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TerritorialResolution>;
  return Boolean(
    typeof candidate.status === 'string' &&
    typeof candidate.confidence === 'string' &&
    typeof candidate.resolvedAt === 'string' &&
    candidate.planning &&
    Array.isArray(candidate.planning.evidence) &&
    Array.isArray(candidate.planning.warnings) &&
    candidate.affects &&
    Array.isArray(candidate.affects.detected) &&
    Array.isArray(candidate.affects.warnings) &&
    Array.isArray(candidate.evidence) &&
    Array.isArray(candidate.warnings) &&
    Array.isArray(candidate.conflicts) &&
    Array.isArray(candidate.candidates)
  );
}

function isCanonicalDetectionSummary(value: unknown): value is TerritorialDetectionSummary {
  return Boolean(value && typeof value === 'object' && (value as TerritorialDetectionSummary).schemaVersion === 1)
}

function buildCanonicalContextView(summary: TerritorialDetectionSummary): TerritorialContextView {
  const checks = (summary.planningSourceChecks ?? summary.reliability?.sourceChecks ?? []) as OfficialSourceCheck[]
  const finalSelection = summary.classificationResolution?.finalSelection
  const selectedCandidate = finalSelection?.candidateId
    ? summary.classificationResolution?.candidates.find((candidate) => candidate.id === finalSelection.candidateId)
    : undefined
  const canonicalOperationalValue =
    summary.classificationDetermination?.technician?.value ??
    summary.classificationDetermination?.automatic?.value ??
    summary.landClass ??
    finalSelection?.operationalValue
  const classification = selectedCandidate?.classification ?? (canonicalOperationalValue
    ? { code: canonicalOperationalValue, label: canonicalOperationalValue, sourceFeatureIds: [] }
    : undefined)
  const manual = summary.manualContext
  const manualOrdinance = summary.ordinanceDetermination?.technician
  const status: TerritorialContextView['status'] = summary.locationStatus === 'confirmed' && summary.planningStatus === 'vigente'
    ? 'confirmed'
    : summary.planningApplicabilityStatus === 'conflict' || (summary.conflicts?.length ?? 0) > 0
      ? 'conflict'
      : summary.locationStatus === 'unresolved' ? 'undetermined' : 'provisional'
  const affects = (summary.affects?.detected ?? []).map((affect) => ({
    category: affect.category,
    name: affect.name,
    confidence: affect.confidence ?? 'unknown',
    origin: 'automatic' as const,
  }))
  return {
    coverage: summary.coverage,
    status,
    confidence: summary.locationConfidence ?? 'low',
    resolvedAt: summary.resolvedAt ?? new Date(0).toISOString(),
    inputMethod: (summary.inputMethod ?? 'unknown') as TerritorialResolution['inputMethod'],
    cadastralReference: summary.cadastralReference ?? undefined,
    parcelReference: summary.parcelReference ?? undefined,
    address: summary.address ?? undefined,
    coordinates: summary.lat != null && summary.lng != null ? { lat: summary.lat, lng: summary.lng } : undefined,
    parcelGeometry: summary.parcelGeometry ?? undefined,
    parcelSurfaceSquareMetres: summary.parcelSurfaceSquareMetres,
    actionArea: summary.actionAreaSelection?.current,
    municipality: summary.municipalityName ?? undefined,
    municipalityCode: summary.municipalityCode ?? undefined,
    province: summary.provinceName ?? undefined,
    classification,
    classificationOrigin: summary.classificationDetermination?.technician ? 'manual' : 'automatic',
    automaticClassification: classification,
    classificationResolution: summary.classificationResolution,
    urbanisticFacts: summary.urbanisticFacts ?? undefined,
    officialLinks: [],
    planningDocuments: summary.planningDocuments ?? [],
    resources: summary.planningResources,
    planningStatus: summary.planningApplicabilityStatus === 'determined' ? 'determined' : summary.planningApplicabilityStatus === 'conflict' ? 'conflict' : summary.planningApplicabilityStatus === 'partial' ? 'partial' : 'not_determined',
    ordinanceDetermination: summary.ordinanceDetermination,
    ordinanceCandidates: summary.ordinanceCandidates,
    contextualCandidates: summary.contextualCandidates,
    ordinanceResolution: summary.ordinanceResolution as TerritorialContextView['ordinanceResolution'],
    areas: summary.planningArea ? [summary.planningArea] : [],
    instrument: summary.planningInstrument ?? undefined,
    affects,
    automaticAffects: affects.map((affect) => ({ ...affect, key: `${affect.category}:${affect.name}`, source: 'detection' })),
    parcelAffects: affects.map((affect) => ({ ...affect, key: `${affect.category}:${affect.name}`, source: 'detection' })),
    conflicts: summary.conflicts?.map((conflict) => conflict.reason) ?? [],
    parcelConflicts: summary.parcelPlanningConflicts ?? [],
    warnings: summary.warnings?.map((warning) => warning.message) ?? [],
    sources: summary.planningEvidence ?? [],
    canAnswerConcreteParameters: summary.planningCanAnswerConcreteParameters ?? false,
    canRuleOutUndetectedAffects: false,
    candidateCount: summary.ordinanceCandidates?.length ?? 0,
    latestAttemptAt: summary.reliability?.latestAttemptAt ?? summary.resolvedAt ?? new Date(0).toISOString(),
    officialContextResolvedAt: summary.reliability?.officialContextResolvedAt ?? undefined,
    usingPreviousOfficialContext: summary.reliability?.usingPreviousOfficialContext ?? false,
    manualContext: manual ? ({ ...manual, validatedBy: undefined } as Omit<ManualTerritorialContext, 'validatedBy'>) : undefined,
    manualOrdinance: manualOrdinance ? ({ ...manualOrdinance, recordedAt: manualOrdinance.recordedAt } as Omit<ContextDetermination<string>, 'recordedBy' | 'validatedBy'>) : undefined,
    technicallyReviewed: summary.reliability?.mode === 'technician_validated_manual',
    sourceChecks: checks,
  }
}

export function buildTerritorialContextView(value: unknown, persisted?: TerritorialDetectionSummary | null): TerritorialContextView | null {
  if (isCanonicalDetectionSummary(value)) return buildCanonicalContextView(value)
  if (!isTerritorialResolution(value)) return null;
  const result = value;
  const canonical = persisted?.schemaVersion === 1 ? persisted : detectionSummary(result);
  const effective = officialContextForUse(result);
  const manual = result.continuity?.manualContext;
  const actionArea = canonical.actionAreaSelection?.current;
  const actionAreaCandidate = actionArea?.selectedCandidateId
    ? effective?.planning.classificationResolution?.candidates.find(
        (candidate) => candidate.id === actionArea.selectedCandidateId
      )
    : undefined;
  const actionAreaClassification = actionAreaCandidate?.classification ??
    (actionArea?.selectionType === 'detected_zone' && actionArea.classification
      ? {
          code: actionArea.classification,
          categoryCode: actionArea.category,
          label: actionArea.classification,
          categoryLabel: actionArea.category,
          sourceFeatureIds: [],
        }
      : undefined);
  // A few legacy contexts persisted the explicit ordinance value before the
  // determination wrapper was introduced. Treat that value as the same
  // user-originated decision; never let a later automatic attempt erase it.
  const manualOrdinance = manual?.ordinanceDetermination?.technician ??
    (manual?.ordinance
      ? {
          value: manual.ordinance,
          origin: 'technician_selection' as const,
          source: 'manual' as const,
          verification: manual.verification,
          recordedAt: manual.recordedAt,
        }
      : undefined);
  const sourceChecks = allSourceChecks(result);
  const incompleteSource = sourceChecks.some((check) =>
    ['partial', 'timeout', 'unavailable', 'malformed'].includes(check.status)
  );
  const parcelPlanningConflicts = effective?.planning.conflicts ?? result.planning.conflicts ?? [];
  const conflicts = [
    ...result.conflicts.map((conflict) => conflict.reason),
    ...(actionArea ? [] : parcelPlanningConflicts),
  ];
  const classificationResolution = effective?.planning.classificationResolution
    ? {
        ...effective.planning.classificationResolution,
        finalSelection: actionAreaClassification && actionArea
          ? {
              origin: 'manual' as const,
              candidateId: actionArea.selectedCandidateId,
              classificationCode: actionAreaClassification.code,
              categoryCode: actionAreaClassification.categoryCode,
              operationalValue: actionAreaClassification.code,
              areaNames: actionArea?.planningZones ?? [],
              reason: 'Zona territorial seleccionada como área de actuación.',
              primarySource: actionArea.source,
              confidence: actionArea.confidence === 'unknown' ? 'low' : actionArea.confidence,
              selectedAt: actionArea.selectedAt,
              technicianValidated: actionArea.verification === 'technician_validated',
            }
          : manual?.classification
          ? {
              origin: 'manual' as const,
              classificationCode: manual.classification,
              categoryCode: manual.category,
              operationalValue: manual.classification,
              areaNames: manual.area ? [manual.area] : [],
              reason: manual.observations || 'Selección manual registrada en el expediente.',
              primarySource: 'manual',
              confidence:
                manual.verification === 'technician_validated' ? ('high' as const) : ('low' as const),
              selectedAt: manual.recordedAt,
              technicianValidated: manual.verification === 'technician_validated',
            }
          : effective.planning.classificationResolution.finalSelection,
        officialLinks: officialResourceLinks(effective),
      }
    : undefined;
  const rawUrbanisticFacts = effective?.planning.urbanisticFacts ??
    (effective?.planning.classificationResolution
      ? urbanisticFactsFromClassificationResolution(effective.planning, result.resolvedAt)
      : undefined);
  const urbanisticFacts = rawUrbanisticFacts
    ? applyActionAreaToUrbanisticFacts(
        applyManualFactDecisions(rawUrbanisticFacts, manual).effective,
        effective,
        actionArea
      )
    : undefined;
  const parcelAutomaticAffects = (effective?.affects ?? result.affects).detected;
  const automaticAffects =
    actionArea?.selectionType === 'detected_zone' && actionArea.affects
      ? actionArea.affects.detected
      : parcelAutomaticAffects;
  const affectResolution = applyManualAffectDecisions(
    automaticAffects,
    manual?.affectDecisions
  );
  const territorialContextComplete = Boolean(
    effective?.status === 'confirmed' &&
      effective.municipality?.trim() &&
      effective.municipalityCode?.trim() &&
      effective.planning.status === 'determined' &&
      effective.planning.instrument?.trim() &&
      effective.planning.classification?.label.trim()
  );
  const isTechnicianValidated =
    manual?.verification === 'technician_validated' ||
    actionArea?.verification === 'technician_validated';

  const status =
    result.conflicts.length ||
    (!classificationResolution && (effective?.planning.status ?? result.planning.status) === 'conflict')
      ? 'conflict'
      : (manual && !isTechnicianValidated) ||
          result.continuity?.usingPreviousOfficialContext ||
          (!isTechnicianValidated && incompleteSource) ||
          (!isTechnicianValidated && Boolean(classificationResolution && classificationResolution.status !== 'clear'))
        ? 'provisional'
      : territorialContextComplete || isTechnicianValidated
        ? 'confirmed'
        : effective?.status === 'confirmed'
          ? 'provisional'
        : effective?.status === 'probable' || result.status === 'ambiguous'
          ? 'approximate'
          : 'undetermined';
  const evidence = [
    ...result.evidence,
    ...result.planning.evidence,
    ...result.affects.detected.map((affect) => affect.evidence),
    ...(effective && effective !== result
      ? [
          ...effective.evidence,
          ...effective.planning.evidence,
          ...effective.affects.detected.map((affect) => affect.evidence),
        ]
      : []),
  ];
  const sources = [
    ...new Map(
      evidence.map((item) => [`${item.source}|${item.sourceUrl}|${item.method}`, item])
    ).values(),
  ];
  const mixedParcelWithoutActionArea = Boolean(
    !actionArea &&
      (classificationResolution?.status === 'multiple_intersections' ||
        (classificationResolution?.candidates.length ?? 0) > 1)
  );

  const ordinanceCandidates = effective?.planning.ordinanceCandidates ?? [];
  const catalogInstrumentId = effective?.planning.applicableInstruments?.find((item) => item.status === 'current')?.id ?? effective?.planning.instrument;
  const ordinanceCatalogOptions = getInstrumentIdentityOptions(effective?.municipalityCode, catalogInstrumentId)
    .map((identity) => ({
      identityId: identity.id,
      code: identity.officialCode,
      label: identity.officialName,
      status: runtimeCatalogStatus(identity.status),
      semanticDimension: identity.semanticDimension,
    }));
  const contextualCandidates = effective?.planning.contextualCandidates ?? effective?.planning.ordinanceResolution?.contextualCandidates ?? [];
  console.log('UB-E2E-TRACE territorial-context-view', JSON.stringify({
    municipalityCode: effective?.municipalityCode ?? null,
    planningInstrument: effective?.planning.instrument ?? null,
    planningStatus: effective?.planning.status ?? null,
    usingPreviousOfficialContext: result.continuity?.usingPreviousOfficialContext ?? false,
    ordinanceCandidates: ordinanceCandidates.map((candidate) => ({
      identity: candidate.identity,
      semanticDimension: candidate.semanticDimension ?? null,
      sourceRef: candidate.sourceRef,
      sourceDocument: candidate.sourceDocument,
      provenance: candidate.provenance,
    })),
    contextualCandidates: contextualCandidates.map((candidate) => ({
      identity: candidate.identity,
      semanticDimension: candidate.semanticDimension ?? null,
      sourceRef: candidate.sourceRef,
      provenance: candidate.provenance,
    })),
    manualOrdinance: manualOrdinance?.value ?? null,
  }))
  const productOrdinanceResolution = effective?.planning.ordinanceResolution ?? {
    status: manualOrdinance ? 'USER_CONFIRMED' as const : 'REVIEW_REQUIRED' as const,
    confidence: manualOrdinance ? 'high' : 'unknown',
    provenance: manualOrdinance ? ['manual:ordinance-selection'] : [],
    confirmationSource: manualOrdinance ? 'user' as const : undefined,
  };
  let ordStatus: 'automatically_determined' | 'assisted_confirmation_required' | 'manual_confirmation_required' | 'ambiguous' | 'multizone' | 'not_available' | undefined = undefined;
  if (effective?.planning.status === 'determined') {
    ordStatus = effective.planning.ordinanceResolutionStatus ??
      (ordinanceCandidates.length > 0 ? 'assisted_confirmation_required' : 'manual_confirmation_required');
  }
  const ordinanceDeterminationState = manual?.ordinanceDetermination ??
    (manualOrdinance ? { technician: manualOrdinance } : undefined);
  const ordinanceDetermination = ordinanceDeterminationState
    ? { ...ordinanceDeterminationState, candidates: ordinanceCandidates, status: ordStatus ?? (ordinanceDeterminationState as ContextDeterminationState<string> & { status?: string }).status }
    : {
        automatic:
          ordStatus === 'automatically_determined' && ordinanceCandidates.length === 1
            ? createAutomaticDetermination(ordinanceCandidates[0]!.identity, 'siotuga')
            : undefined,
        candidates: ordinanceCandidates,
        status: ordStatus,
      };

  return {
    status,
    planningStatus: effective?.planning.status ?? result.planning.status,
    ordinanceDetermination,
    ordinanceCandidates: ordinanceCandidates.map((candidate) => ({
      identity: candidate.identity,
      semanticDimension: candidate.semanticDimension,
      coverage: candidate.coverage,
      confidence: candidate.confidence,
      sourceRef: candidate.sourceRef,
      sourceDocument: candidate.sourceDocument,
      graphicEvidence: candidate.graphicEvidence,
      legendEvidence: candidate.legendEvidence,
      documentaryEvidence: candidate.documentaryEvidence,
      provenance: candidate.provenance,
      alignmentMethod: candidate.alignmentMethod,
      estimatedErrorMeters: candidate.estimatedErrorMeters,
      warning: candidate.warning,
      identityId: candidate.identityId,
      catalogStatus: candidate.catalogStatus,
      normativeReferences: candidate.normativeReferences,
    })),
    contextualCandidates: contextualCandidates.map((candidate) => ({
      identity: candidate.identity,
      semanticDimension: candidate.semanticDimension,
      confidence: candidate.confidence,
      sourceRef: candidate.sourceRef,
      provenance: candidate.provenance,
    })),
    ordinanceCatalogOptions,
  ordinanceResolution: manualOrdinance
      ? {
          ...productOrdinanceResolution,
          status: 'USER_CONFIRMED' as const,
          confirmationSource: 'user' as const,
          confirmedByUser: true,
          identityId: productOrdinanceResolution.identityId,
          normativeReferences: productOrdinanceResolution.normativeReferences,
          hasEligibility: productOrdinanceResolution.hasEligibility,
        }
      : productOrdinanceResolution,
    confidence: effective?.confidence ?? result.confidence,
    resolvedAt: result.resolvedAt,
    inputMethod: result.inputMethod,
    cadastralReference: effective?.cadastralReference ?? manual?.cadastralReference,
    parcelReference: effective?.parcelReference,
    address: effective?.normalizedAddress ?? manual?.address,
    coordinates: effective?.coordinates ?? manual?.coordinates,
    parcelGeometry: effective?.parcelGeometry,
    parcelSurfaceSquareMetres: canonical.parcelSurfaceSquareMetres,
    coverage: canonical.coverage,
    actionArea,
    municipality: effective?.municipality ?? manual?.municipality,
    municipalityCode: effective?.municipalityCode,
    province: effective?.province,
    classification:
      canonical.classificationDetermination?.technician?.value ? { code: canonical.classificationDetermination.technician.value, label: canonical.classificationDetermination.technician.value, sourceFeatureIds: [] } :
      actionAreaClassification
        ? actionAreaClassification
        : manual?.classification
        ? {
            code: manual.classification,
            categoryCode: manual.category,
            label: manual.classification,
            categoryLabel: manual.category,
            sourceFeatureIds: [],
          }
        : effective?.planning.classification,
    classificationOrigin: actionAreaClassification || manual?.classification
      ? 'manual'
      : effective?.planning.classification
        ? 'automatic'
        : undefined,
    automaticClassification: effective?.planning.classification,
    classificationResolution,
    urbanisticFacts: canonical.urbanisticFacts ?? urbanisticFacts,
    officialLinks: effective ? officialResourceLinks(effective) : [],
    planningDocuments: effective?.planning.documents,
    resources: effective?.planning.resources ?? result.planning.resources,
    areas:
      actionArea?.selectionType === 'detected_zone'
        ? actionArea.planningZones ?? []
        : manual?.area
          ? [manual.area]
          : (effective?.planning.areas?.map((area) => area.name) ?? []),
    instrument: canonical.planningInstrument ?? effective?.planning.instrument,
    affects: affectResolution.effective.map((affect) => ({
      key: territorialAffectKey(affect),
      category: affect.category,
      name: affect.name,
      confidence: affect.confidence,
      origin: affect.evidence.source === 'urbanbrain' ? 'manual' : 'automatic',
    })),
    automaticAffects: automaticAffects.map((affect) => ({
      key: territorialAffectKey(affect),
      category: affect.category,
      name: affect.name,
      confidence: affect.confidence,
      source: affect.evidence.source,
    })),
    parcelAffects: parcelAutomaticAffects.map((affect) => ({
      key: territorialAffectKey(affect),
      category: affect.category,
      name: affect.name,
      confidence: affect.confidence,
      source: affect.evidence.source,
    })),
    conflicts,
    parcelConflicts: parcelPlanningConflicts,
    warnings: [
      ...(result.status === 'ambiguous' && result.candidates.length > 1
        ? [`La dirección devolvió ${result.candidates.length} candidatos y requiere selección.`]
        : []),
      ...result.warnings.map((warning) => warning.message),
      ...result.planning.warnings.map((warning) => warning.message),
      ...result.affects.warnings.map((warning) => warning.message),
      ...sourceChecks.map((check) => check.message),
      ...(mixedParcelWithoutActionArea
        ? [
            'La parcela contiene varias zonas territoriales. Seleccione un área de actuación para utilizar un régimen concreto.',
          ]
        : []),
      ...(actionArea && parcelPlanningConflicts.length > 0
        ? [
            'La parcela completa conserva varios regímenes. El contexto efectivo se limita al área de actuación seleccionada.',
          ]
        : []),
    ],
    sources,
    canAnswerConcreteParameters:
      effective?.planning.canAnswerConcreteParameters === true &&
      manual?.verification !== 'unverified' &&
      (!actionArea || actionArea.verification === 'technician_validated'),
    canRuleOutUndetectedAffects: false,
    candidateCount: result.candidates.length,
    latestAttemptAt: result.attemptStartedAt ?? result.resolvedAt,
    officialContextResolvedAt: effective?.resolvedAt,
    usingPreviousOfficialContext:
      result.continuity?.usingPreviousOfficialContext ?? false,
    manualContext: manual
      ? {
          cadastralReference: manual.cadastralReference,
          municipality: manual.municipality,
          address: manual.address,
          coordinates: manual.coordinates,
          classification: manual.classification,
          category: manual.category,
          area: manual.area,
          ordinance: manual.ordinance,
          observations: manual.observations,
          affectDecisions: manual.affectDecisions,
          actionAreaSelection: manual.actionAreaSelection,
          provenance: manual.provenance,
          verification: manual.verification,
          recordedAt: manual.recordedAt,
          validatedAt: manual.validatedAt,
        }
      : undefined,
    manualOrdinance: manualOrdinance
      ? {
          value: manualOrdinance.value,
          origin: manualOrdinance.origin,
          source: manualOrdinance.source,
          verification: manualOrdinance.verification,
          determinedAt: manualOrdinance.determinedAt,
          recordedAt: manualOrdinance.recordedAt,
          validatedAt: manualOrdinance.validatedAt,
          previousAutomaticValue: manualOrdinance.previousAutomaticValue,
        }
      : undefined,
    technicallyReviewed: manual?.verification === 'technician_validated',
    sourceChecks,
  };
}
