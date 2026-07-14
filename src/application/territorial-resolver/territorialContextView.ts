import type {
  TerritorialEvidence,
  ManualTerritorialContext,
  OfficialSourceCheck,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types';
import {
  allSourceChecks,
  officialContextForUse,
} from '@/application/territorial-resolver/territorialContinuity';

export interface TerritorialContextView {
  status: 'confirmed' | 'approximate' | 'provisional' | 'conflict' | 'undetermined';
  confidence: TerritorialResolution['confidence'];
  resolvedAt: string;
  inputMethod: TerritorialResolution['inputMethod'];
  cadastralReference?: string;
  address?: string;
  municipality?: string;
  municipalityCode?: string;
  classification?: TerritorialResolution['planning']['classification'];
  areas: string[];
  instrument?: string;
  affects: Array<{ category: string; name: string; confidence: string }>;
  conflicts: string[];
  warnings: string[];
  sources: TerritorialEvidence[];
  canAnswerConcreteParameters: boolean;
  canRuleOutUndetectedAffects: false;
  candidateCount: number;
  latestAttemptAt: string;
  officialContextResolvedAt?: string;
  usingPreviousOfficialContext: boolean;
  manualContext?: Omit<ManualTerritorialContext, 'validatedBy'>;
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
  const sourceChecks = allSourceChecks(result);
  const incompleteSource = sourceChecks.some((check) =>
    ['partial', 'timeout', 'unavailable', 'malformed'].includes(check.status)
  );
  const conflicts = [
    ...result.conflicts.map((conflict) => conflict.reason),
    ...(effective?.planning.conflicts ?? result.planning.conflicts ?? []),
  ];
  const status =
    conflicts.length || result.planning.status === 'conflict'
      ? 'conflict'
      : manual || result.continuity?.usingPreviousOfficialContext || incompleteSource
        ? 'provisional'
      : effective?.status === 'confirmed'
        ? 'confirmed'
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

  return {
    status,
    confidence: effective?.confidence ?? result.confidence,
    resolvedAt: result.resolvedAt,
    inputMethod: result.inputMethod,
    cadastralReference: effective?.cadastralReference ?? manual?.cadastralReference,
    address: effective?.normalizedAddress ?? manual?.address,
    municipality: effective?.municipality ?? manual?.municipality,
    municipalityCode: effective?.municipalityCode,
    classification:
      effective?.planning.classification ??
      (manual?.classification
        ? {
            code: manual.classification,
            categoryCode: manual.category,
            label: manual.classification,
            categoryLabel: manual.category,
            sourceFeatureIds: [],
          }
        : undefined),
    areas:
      effective?.planning.areas?.map((area) => area.name) ?? (manual?.area ? [manual.area] : []),
    instrument: effective?.planning.instrument,
    affects: (effective?.affects ?? result.affects).detected.map((affect) => ({
      category: affect.category,
      name: affect.name,
      confidence: affect.confidence,
    })),
    conflicts,
    warnings: [
      ...(result.status === 'ambiguous' && result.candidates.length > 1
        ? [`La dirección devolvió ${result.candidates.length} candidatos y requiere selección.`]
        : []),
      ...result.warnings.map((warning) => warning.message),
      ...result.planning.warnings.map((warning) => warning.message),
      ...result.affects.warnings.map((warning) => warning.message),
      ...sourceChecks.map((check) => check.message),
    ],
    sources,
    canAnswerConcreteParameters:
      effective?.planning.canAnswerConcreteParameters === true &&
      manual?.verification !== 'unverified',
    canRuleOutUndetectedAffects: false,
    candidateCount: result.candidates.length,
    latestAttemptAt: result.resolvedAt,
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
          provenance: manual.provenance,
          verification: manual.verification,
          recordedAt: manual.recordedAt,
          validatedAt: manual.validatedAt,
        }
      : undefined,
    sourceChecks,
  };
}
