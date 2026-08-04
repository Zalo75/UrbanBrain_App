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

export interface TerritorialContextView {
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

export function buildTerritorialContextView(value: unknown): TerritorialContextView | null {
  if (!isTerritorialResolution(value)) return null;
  const result = value;
  const effective = officialContextForUse(result);
  const manual = result.continuity?.manualContext;
  const actionArea = manual?.actionAreaSelection?.current;
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
  const manualOrdinance = manual?.ordinanceDetermination?.technician;
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
  const status =
    result.conflicts.length ||
    (!classificationResolution && (effective?.planning.status ?? result.planning.status) === 'conflict')
      ? 'conflict'
      : manual ||
          result.continuity?.usingPreviousOfficialContext ||
          incompleteSource ||
          Boolean(classificationResolution && classificationResolution.status !== 'clear')
        ? 'provisional'
      : territorialContextComplete
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

  return {
    status,
    confidence: effective?.confidence ?? result.confidence,
    resolvedAt: result.resolvedAt,
    inputMethod: result.inputMethod,
    cadastralReference: effective?.cadastralReference ?? manual?.cadastralReference,
    parcelReference: effective?.parcelReference,
    address: effective?.normalizedAddress ?? manual?.address,
    coordinates: effective?.coordinates ?? manual?.coordinates,
    parcelGeometry: effective?.parcelGeometry,
    parcelSurfaceSquareMetres: actionArea?.parcelSurfaceSquareMetres,
    actionArea,
    municipality: effective?.municipality ?? manual?.municipality,
    municipalityCode: effective?.municipalityCode,
    province: effective?.province,
    classification:
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
    urbanisticFacts,
    officialLinks: effective ? officialResourceLinks(effective) : [],
    planningDocuments: effective?.planning.documents,
    areas:
      actionArea?.selectionType === 'detected_zone'
        ? actionArea.planningZones ?? []
        : manual?.area
          ? [manual.area]
          : (effective?.planning.areas?.map((area) => area.name) ?? []),
    instrument: effective?.planning.instrument,
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
