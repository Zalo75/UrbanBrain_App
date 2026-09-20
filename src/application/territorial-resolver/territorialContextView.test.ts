import { describe, expect, it } from 'vitest';

import type { TerritorialResolution } from '@/domain/territorial-resolver/types';
import type { TerritorialDetectionSummary } from '@/application/parcel-context/normalizeParcelContext';
import { buildTerritorialContextView } from './territorialContextView';

const base: TerritorialResolution = {
  status: 'confirmed',
  confidence: 'high',
  inputMethod: 'coordinates',
  candidates: [],
  evidence: [
    {
      source: 'catastro',
      sourceUrl: 'https://official.test/catastro',
      retrievedAt: '2026-07-14T00:00:00.000Z',
      method: 'fixture',
    },
  ],
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

  it('proyecta la clasificación operativa canónica aunque falte candidateId', () => {
    const summary: TerritorialDetectionSummary = {
      schemaVersion: 1,
      landClass: 'urbanizable',
      classificationResolution: {
        status: 'review_required', nextAction: 'manual_selection', candidates: [], discrepancies: [],
        reviewReasons: ['insufficient_geometry'], sourceChecks: [], officialLinks: [], evidence: [],
        finalSelection: { origin: 'manual', operationalValue: 'urbanizable', areaNames: ['SURT1'], technicianValidated: false },
      },
      planningArea: 'SURT1', planningApplicabilityStatus: 'partial', locationStatus: 'confirmed', locationConfidence: 'high',
      coverage: { status: 'unresolved', portions: [], analysedSurfaceSquareMetres: 100, coveredSurfaceSquareMetres: 0, unresolvedSurfaceSquareMetres: 100, toleranceSquareMetres: 1, overlapSurfaceSquareMetres: 0, reasons: [] },
      resolvedAt: base.resolvedAt,
    }
    const view = buildTerritorialContextView(summary)
    expect(view?.classification).toMatchObject({ code: 'urbanizable', label: 'urbanizable' })
    expect(view?.areas).toEqual(['SURT1'])
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
    const parcelGeometry: TerritorialResolution['parcelGeometry'] = {
      type: 'MultiPolygon',
      crs: 'EPSG:4326',
      coordinates: [[[[-8.218, 43.271], [-8.217, 43.271], [-8.218, 43.271]]]],
    };
    const view = buildTerritorialContextView({
      ...base,
      coordinates: { lat: 43.271234, lng: -8.217654 },
      parcelGeometry,
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
      parcelGeometry,
      technicallyReviewed: false,
    });
  });

  it('no confirma el contexto global cuando faltan municipio, INE, planeamiento o clasificación', () => {
    const view = buildTerritorialContextView({
      ...base,
      sourceChecks: [
        {
          source: 'ideg',
          status: 'available',
          checkedAt: base.resolvedAt,
          message: 'IDEG respondio correctamente para las capas verificadas.',
        },
      ],
    });

    expect(view?.status).toBe('provisional');
  });

  it('mantiene visibles las afecciones positivas aunque el contexto territorial siga parcial', () => {
    const view = buildTerritorialContextView({
      ...base,
      municipality: 'Culleredo',
      municipalityCode: '15031',
      cadastralReference: '7709702NH4970N0001SZ',
      parcelReference: '7709702NH4970N',
      affects: {
        ...base.affects,
        detected: [
          {
            category: 'patrimonio_cultural',
            name: 'BIC: contorno de protección',
            confidence: 'high',
            attributes: {},
            evidence: {
              source: 'ideg',
              sourceUrl: 'https://official.test/ideg',
              retrievedAt: base.resolvedAt,
              method: 'fixture',
            },
          },
        ],
      },
    });

    expect(view).toMatchObject({
      status: 'provisional',
      cadastralReference: '7709702NH4970N0001SZ',
      parcelReference: '7709702NH4970N',
      affects: [
        { category: 'patrimonio_cultural', name: 'BIC: contorno de protección' },
      ],
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

  it('expone USER_CONFIRMED al recargar una selección de candidata existente', () => {
    const view = buildTerritorialContextView({
      ...base,
      status: 'unresolved',
      cadastralReference: '1234567NH4913S',
      municipality: 'Betanzos',
      municipalityCode: '15009',
      planning: {
        status: 'not_determined',
        evidence: [],
        warnings: [],
      },
      continuity: {
        usingPreviousOfficialContext: true,
        sameParcelAsPrevious: true,
        effectiveOfficialContext: {
          ...base,
          cadastralReference: '1234567NH4913S',
          municipality: 'Betanzos',
          municipalityCode: '15009',
          planning: {
            status: 'determined',
            evidence: [],
            warnings: [],
            ordinanceCandidates: [{
              identity: 'R-2',
              semanticDimension: 'ordinance',
              provenance: ['official:wms'],
            }],
            ordinanceResolution: {
              status: 'REVIEW_REQUIRED',
              confidence: 'high',
              provenance: ['official:wms'],
            },
          },
        },
        manualContext: {
          provenance: 'manual',
          verification: 'unverified',
          recordedAt: '2026-07-14T12:00:00.000Z',
          ordinance: 'R-2',
          ordinanceDetermination: {
            technician: {
              value: 'R-2',
              origin: 'technician_selection',
              source: 'manual',
              verification: 'unverified',
              recordedAt: '2026-07-14T12:00:00.000Z',
              recordedBy: 'user-a',
            },
          },
        },
      },
    });

    expect(view?.ordinanceResolution).toMatchObject({
      status: 'USER_CONFIRMED',
      confirmationSource: 'user',
      confirmedByUser: true,
      provenance: ['official:wms'],
    });
    expect(view?.ordinanceCandidates).toHaveLength(1);
    expect(view?.ordinanceCandidates?.[0]).toMatchObject({ identity: 'R-2' });
  });
});
