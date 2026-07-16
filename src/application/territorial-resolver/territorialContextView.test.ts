import { describe, expect, it } from 'vitest';

import type { TerritorialResolution } from '@/domain/territorial-resolver/types';
import { buildTerritorialContextView } from './territorialContextView';

const base: TerritorialResolution = {
  status: 'confirmed',
  confidence: 'high',
  inputMethod: 'coordinates',
  candidates: [],
  evidence: [],
  warnings: [],
  conflicts: [],
  planning: { status: 'partial', evidence: [], warnings: [] },
  affects: {
    analysisGeometry: 'parcel',
    detected: [],
    canRuleOutUndetectedAffects: false,
    warnings: [],
  },
  resolvedAt: '2026-07-14T00:00:00.000Z',
};

describe('buildTerritorialContextView', () => {
  it('no rompe la ficha ante una detección histórica con otro formato', () => {
    expect(buildTerritorialContextView({ status: 'legacy', summary: {} })).toBeNull();
  });

  it('presenta como conflictiva una discrepancia entre punto y parcela', () => {
    const view = buildTerritorialContextView({
      ...base,
      planning: {
        ...base.planning,
        status: 'conflict',
        conflicts: ['El punto no coincide con toda la geometría parcelaria.'],
      },
    });

    expect(view).toMatchObject({
      status: 'conflict',
      canAnswerConcreteParameters: false,
      canRuleOutUndetectedAffects: false,
    });
    expect(view?.conflicts).toContain('El punto no coincide con toda la geometría parcelaria.');
  });

  it('expone las coordenadas reales de la detección como fuente canónica de la interfaz', () => {
    const view = buildTerritorialContextView({
      ...base,
      coordinates: { lat: 43.271234, lng: -8.217654 },
      municipality: 'Betanzos',
      evidence: [
        {
          source: 'catastro',
          sourceUrl: 'https://official.test/catastro',
          retrievedAt: base.resolvedAt,
          method: 'test',
        },
      ],
    });

    expect(view).toMatchObject({
      municipality: 'Betanzos',
      coordinates: { lat: 43.271234, lng: -8.217654 },
      technicallyReviewed: false,
    });
  });

  it('solo presenta revisión técnica cuando existe evidencia manual explícita', () => {
    const unverified = buildTerritorialContextView({
      ...base,
      continuity: {
        usingPreviousOfficialContext: false,
        sameParcelAsPrevious: false,
        manualContext: {
          provenance: 'manual',
          verification: 'unverified',
          recordedAt: base.resolvedAt,
        },
      },
    });
    const reviewed = buildTerritorialContextView({
      ...base,
      continuity: {
        usingPreviousOfficialContext: false,
        sameParcelAsPrevious: false,
        manualContext: {
          provenance: 'manual',
          verification: 'technician_validated',
          recordedAt: base.resolvedAt,
          validatedAt: base.resolvedAt,
          validatedBy: 'technician-a',
        },
      },
    });

    expect(unverified?.technicallyReviewed).toBe(false);
    expect(reviewed?.technicallyReviewed).toBe(true);
  });
});
