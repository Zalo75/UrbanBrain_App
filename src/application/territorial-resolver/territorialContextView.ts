import type {
  TerritorialEvidence,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types';

export interface TerritorialContextView {
  status: 'confirmed' | 'approximate' | 'conflict' | 'undetermined';
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
  const conflicts = [
    ...result.conflicts.map((conflict) => conflict.reason),
    ...(result.planning.conflicts ?? []),
  ];
  const status =
    conflicts.length || result.planning.status === 'conflict'
      ? 'conflict'
      : result.status === 'confirmed'
        ? 'confirmed'
        : result.status === 'probable' || result.status === 'ambiguous'
          ? 'approximate'
          : 'undetermined';
  const evidence = [
    ...result.evidence,
    ...result.planning.evidence,
    ...result.affects.detected.map((affect) => affect.evidence),
  ];
  const sources = [
    ...new Map(
      evidence.map((item) => [`${item.source}|${item.sourceUrl}|${item.method}`, item])
    ).values(),
  ];

  return {
    status,
    confidence: result.confidence,
    resolvedAt: result.resolvedAt,
    inputMethod: result.inputMethod,
    cadastralReference: result.cadastralReference,
    address: result.normalizedAddress,
    municipality: result.municipality,
    municipalityCode: result.municipalityCode,
    classification: result.planning.classification,
    areas: result.planning.areas?.map((area) => area.name) ?? [],
    instrument: result.planning.instrument,
    affects: result.affects.detected.map((affect) => ({
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
    ],
    sources,
    canAnswerConcreteParameters: result.planning.canAnswerConcreteParameters === true,
    canRuleOutUndetectedAffects: result.affects.canRuleOutUndetectedAffects,
    candidateCount: result.candidates.length,
  };
}
