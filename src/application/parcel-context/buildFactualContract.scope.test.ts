import { describe, expect, it } from 'vitest';
import type { NormalizedParcelContext } from '@/domain/parcel-context/types';
import type {
  UrbanisticFactStatus,
  UrbanisticRegimeFacts,
} from '@/domain/territorial-resolver/types';
import { buildTerritorialFactualContract } from './buildFactualContract';

interface RegimeFactsOptions {
  classificationCode: string;
  classificationLabel?: string;
  classificationStatus?: UrbanisticFactStatus;
  classificationCandidates?: Array<{ code: string; label?: string; percentage?: number }>;
  categoryCode?: string;
  categoryLabel?: string;
  categoryCandidates?: Array<{ code: string; label?: string; percentage: number }>;
}

function createRegimeFacts({
  classificationCode,
  classificationLabel,
  classificationStatus = 'automatic_confirmed',
  classificationCandidates,
  categoryCode,
  categoryLabel,
  categoryCandidates,
}: RegimeFactsOptions): UrbanisticRegimeFacts {
  return {
    classification: {
      value: { code: classificationCode, label: classificationLabel },
      status: classificationStatus,
      origin: 'spatial_intersection',
      confidence: classificationStatus === 'source_unavailable' ? 'unknown' : 'high',
      evidence: [],
      warnings: [],
      discrepancies: [],
      nextAction: classificationStatus === 'source_unavailable' ? 'retry_source' : 'none',
      candidates: classificationCandidates?.map((candidate) => ({
        value: { code: candidate.code, label: candidate.label },
        parcelPercentage: candidate.percentage,
      })),
    },
    category: categoryCandidates
      ? {
          status: 'conflict',
          origin: 'spatial_intersection',
          confidence: 'high',
          evidence: [],
          warnings: [],
          discrepancies: [],
          nextAction: 'manual_selection',
          candidates: categoryCandidates.map((candidate) => ({
            value: { code: candidate.code, label: candidate.label },
            parcelPercentage: candidate.percentage,
          })),
        }
      : categoryCode
        ? {
            value: { code: categoryCode, label: categoryLabel },
            status: 'automatic_confirmed',
            origin: 'spatial_intersection',
            confidence: 'high',
            evidence: [],
            warnings: [],
            discrepancies: [],
            nextAction: 'none',
          }
        : {
            status: 'not_available',
            confidence: 'unknown',
            evidence: [],
            warnings: [],
            discrepancies: [],
            nextAction: 'none',
          },
    consolidation: {
      status: 'not_available',
      confidence: 'unknown',
      evidence: [],
      warnings: [],
      discrepancies: [],
      nextAction: 'none',
    },
  };
}

function createActionArea(): NonNullable<NormalizedParcelContext['actionArea']> {
  return {
    value: {
      id: 'action-area-1',
      selectionType: 'detected_zone',
      surfaceSquareMetres: 200,
      parcelSurfaceSquareMetres: 1000,
      geometry: { type: 'MultiPolygon', coordinates: [], crs: 'EPSG:4326' },
      source: 'user_polygon',
      confidence: 'high',
      selectedBy: 'user',
      selectedAt: '2026-08-12T10:00:00.000Z',
      verification: 'technician_validated',
    },
    source: 'manual',
    confidence: 1,
    verification: 'confirmed',
  };
}

describe('L2.6 BLOQUE 2.2A - preservacion factual por scope', () => {
  it('conserva los hechos de parcela y no inventa actionArea cuando no existe', () => {
    const parcelFacts = createRegimeFacts({
      classificationCode: 'SU',
      classificationLabel: 'Suelo urbano',
      categoryCode: 'SUC',
      categoryLabel: 'Suelo urbano consolidado',
    });
    const contract = buildTerritorialFactualContract({
      urbanisticFacts: parcelFacts,
      parcelUrbanisticFacts: parcelFacts,
      planningArea: {
        value: 'ORD-1',
        source: 'siotuga',
        confidence: 1,
        verification: 'confirmed',
      },
      knownConstraints: [],
      parcelKnownConstraints: [],
      conflicts: [],
      pendingValidation: [],
    });

    expect(contract.factsByScope?.parcel?.classification).toMatchObject({
      code: 'SU',
      label: 'Suelo urbano',
      semanticCompleteness: 'complete',
      status: 'automatic_confirmed',
      determination: 'automatic',
    });
    expect(contract.factsByScope?.parcel?.categories?.[0]).toMatchObject({
      code: 'SUC',
      label: 'Suelo urbano consolidado',
    });
    expect(contract.factsByScope?.parcel?.planningAreas?.[0].code).toBe('ORD-1');
    expect(contract.factsByScope?.actionArea).toBeUndefined();
  });

  it('mapea simultaneamente parcelUrbanisticFacts y urbanisticFacts a scopes distintos', () => {
    const parcelFacts = createRegimeFacts({
      classificationCode: 'SR',
      classificationLabel: 'Suelo rustico',
      categoryCode: 'SRP',
    });
    const actionAreaFacts = createRegimeFacts({
      classificationCode: 'SU',
      classificationLabel: 'Suelo urbano',
      categoryCode: 'SUC',
    });
    const contract = buildTerritorialFactualContract({
      parcelUrbanisticFacts: parcelFacts,
      urbanisticFacts: actionAreaFacts,
      actionArea: createActionArea(),
      planningArea: {
        value: 'AA-1',
        source: 'manual',
        confidence: 1,
        verification: 'confirmed',
      },
      knownConstraints: [],
      parcelKnownConstraints: [],
      conflicts: [],
      pendingValidation: [],
    });

    expect(contract.factsByScope?.parcel?.classification?.code).toBe('SR');
    expect(contract.factsByScope?.parcel?.categories?.[0].code).toBe('SRP');
    expect(contract.factsByScope?.actionArea?.classification?.code).toBe('SU');
    expect(contract.factsByScope?.actionArea?.categories?.[0].code).toBe('SUC');
    expect(contract.factsByScope?.actionArea?.planningAreas?.[0].code).toBe('AA-1');
    expect(contract.factsByScope?.parcel?.planningAreas).toBeUndefined();
    expect(contract.classification.code).toBe('SU');
  });

  it('mantiene como facts diferentes el mismo classification code en ambos scopes', () => {
    const contract = buildTerritorialFactualContract({
      parcelUrbanisticFacts: createRegimeFacts({
        classificationCode: 'SNR',
        classificationLabel: 'Regimen de parcela',
      }),
      urbanisticFacts: createRegimeFacts({
        classificationCode: 'SNR',
        classificationLabel: 'Regimen del area',
      }),
      actionArea: createActionArea(),
      knownConstraints: [],
      parcelKnownConstraints: [],
      conflicts: [],
      pendingValidation: [],
    });

    const parcelClassification = contract.factsByScope?.parcel?.classification;
    const actionAreaClassification = contract.factsByScope?.actionArea?.classification;
    expect(parcelClassification?.code).toBe('SNR');
    expect(actionAreaClassification?.code).toBe('SNR');
    expect(parcelClassification?.label).toBe('Regimen de parcela');
    expect(actionAreaClassification?.label).toBe('Regimen del area');
    expect(parcelClassification).not.toBe(actionAreaClassification);
  });

  it('caso Sada conserva percentages y candidates sin mezclar los scopes', () => {
    const contract = buildTerritorialFactualContract({
      parcelUrbanisticFacts: createRegimeFacts({
        classificationCode: 'SNR',
        classificationLabel: 'Suelo de nucleo rural',
        classificationStatus: 'conflict',
        classificationCandidates: [
          { code: 'SNR-A', label: 'Alternativa A', percentage: 98.53 },
          { code: 'SNR-B', label: 'Alternativa B', percentage: 1.47 },
        ],
        categoryCandidates: [
          { code: 'SNRC', label: 'Nucleo rural comun', percentage: 98.53 },
          { code: 'SNRT', label: 'Nucleo rural tradicional', percentage: 1.47 },
        ],
      }),
      urbanisticFacts: createRegimeFacts({
        classificationCode: 'SNR',
        classificationLabel: 'Suelo de nucleo rural',
        categoryCode: 'SNRC',
        categoryLabel: 'Nucleo rural comun',
      }),
      actionArea: createActionArea(),
      knownConstraints: [],
      parcelKnownConstraints: [],
      conflicts: [],
      pendingValidation: [],
    });

    expect(contract.factsByScope?.parcel?.classification?.candidates).toEqual([
      {
        code: 'SNR-A',
        label: 'Alternativa A',
        semanticCompleteness: 'complete',
        parcelPercentage: 98.53,
        intersectionAreaSquareMetres: undefined,
      },
      {
        code: 'SNR-B',
        label: 'Alternativa B',
        semanticCompleteness: 'complete',
        parcelPercentage: 1.47,
        intersectionAreaSquareMetres: undefined,
      },
    ]);
    expect(
      contract.factsByScope?.parcel?.categories?.map((category) => ({
        code: category.code,
        percentage: category.parcelPercentage,
      }))
    ).toEqual([
      { code: 'SNRC', percentage: 98.53 },
      { code: 'SNRT', percentage: 1.47 },
    ]);
    expect(contract.factsByScope?.actionArea?.categories).toHaveLength(1);
    expect(contract.factsByScope?.actionArea?.categories?.[0].code).toBe('SNRC');
    expect(
      contract.factsByScope?.actionArea?.categories?.[0].parcelPercentage
    ).toBeUndefined();
  });

  it('aisla unresolved y semanticCompleteness entre parcela y actionArea', () => {
    const contract = buildTerritorialFactualContract({
      parcelUrbanisticFacts: createRegimeFacts({
        classificationCode: 'SNR',
        classificationStatus: 'source_unavailable',
      }),
      urbanisticFacts: createRegimeFacts({
        classificationCode: 'SU',
        classificationLabel: 'Suelo urbano',
      }),
      actionArea: createActionArea(),
      knownConstraints: [],
      parcelKnownConstraints: [],
      conflicts: [],
      pendingValidation: [],
    });

    expect(contract.factsByScope?.parcel?.classification).toMatchObject({
      code: 'SNR',
      semanticCompleteness: 'partial',
      status: 'source_unavailable',
      determination: 'unresolved',
    });
    expect(contract.factsByScope?.actionArea?.classification).toMatchObject({
      code: 'SU',
      semanticCompleteness: 'complete',
      status: 'automatic_confirmed',
      determination: 'automatic',
    });
  });

  it('no mezcla knownConstraints de actionArea con parcelKnownConstraints', () => {
    const contract = buildTerritorialFactualContract({
      parcelUrbanisticFacts: createRegimeFacts({ classificationCode: 'SR' }),
      urbanisticFacts: createRegimeFacts({ classificationCode: 'SU' }),
      actionArea: createActionArea(),
      knownConstraints: [
        {
          value: 'Costas: servidumbre del area',
          source: 'ideg',
          confidence: 0.95,
          verification: 'confirmed',
        },
      ],
      parcelKnownConstraints: [
        {
          value: 'Patrimonio: afeccion parcelaria',
          source: 'ideg',
          confidence: 0.75,
          verification: 'unverified',
        },
      ],
      conflicts: [],
      pendingValidation: [],
    });

    expect(contract.factsByScope?.parcel?.affects?.items.map((item) => item.label)).toEqual([
      'Patrimonio: afeccion parcelaria',
    ]);
    expect(contract.factsByScope?.actionArea?.affects?.items.map((item) => item.label)).toEqual([
      'Costas: servidumbre del area',
    ]);
  });
});
