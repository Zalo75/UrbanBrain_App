import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  ClassificationCandidate,
  ClassificationResolution,
  OfficialClassificationCandidate,
} from '@/domain/territorial-resolver/types';
import { ClassificationResolutionPanel } from './ClassificationResolutionPanel';

const evidence = {
  source: 'siotuga' as const,
  sourceUrl: 'https://siotuga.xunta.gal/official',
  retrievedAt: '2026-07-24T10:00:00.000Z',
  method: 'WFS oficial',
  scope: 'planning_classification' as const,
};

function candidate(id: string, code: string, category: string): OfficialClassificationCandidate {
  return {
    kind: 'official_classification' as const,
    id,
    classification: {
      code,
      categoryCode: category,
      label: `Clasificación ${code}`,
      sourceFeatureIds: [id],
    },
    areas: [{ type: 'zone', name: `Ámbito ${id}`, sourceFeatureIds: [id] }],
    source: 'siotuga',
    evidence: [evidence],
    confidence: 'high',
    evidenceBasis: 'parcel_geometry',
    instrumentTraceability: 'verified',
    normalizationStatus: 'mapped',
    parcelCoverage: {
      parcelAreaSquareMetres: 1_000,
      intersectionAreaSquareMetres: code === 'SU' ? 600 : 400,
      parcelPercentage: code === 'SU' ? 60 : 40,
      method: 'polygon_intersection',
    },
  };
}

function resolution(
  overrides: Partial<ClassificationResolution> = {}
): ClassificationResolution {
  return {
    status: 'multiple_intersections',
    nextAction: 'manual_selection',
    candidates: [candidate('one', 'SU', 'SUC'), candidate('two', 'SNR', 'SNRSC')],
    discrepancies: [],
    reviewReasons: [],
    sourceChecks: [
      {
        source: 'siotuga',
        status: 'available',
        checkedAt: evidence.retrievedAt,
        message: 'La fuente oficial respondió correctamente.',
        requiredForAutomaticDecision: true,
      },
    ],
    officialLinks: [
      {
        kind: 'catastro_viewer',
        label: 'Ver en Catastro',
        url: 'https://www1.sedecatastro.gob.es/Cartografia/mapa.aspx?refcat=test',
        source: 'catastro',
        scope: 'parcel',
      },
    ],
    evidence: [evidence],
    ...overrides,
  };
}

describe('ClassificationResolutionPanel', () => {
  it('presenta una clasificacion probable sin confundirla con un conflicto espacial', () => {
    const onlyCandidate = candidate('sada-su', 'SU', 'SUSC');
    render(
      <ClassificationResolutionPanel
        resolution={resolution({
          status: 'probable',
          confidenceLevel: 'probable',
          nextAction: 'review_official_sources',
          candidates: [onlyCandidate],
          automaticSelection: {
            origin: 'automatic',
            candidateId: onlyCandidate.id,
            classificationCode: 'SU',
            categoryCode: 'SUSC',
            areaNames: ['Ambito sada-su'],
            reason: 'Clasificacion espacial unica con comprobacion documental pendiente.',
            primarySource: 'siotuga',
            confidence: 'medium',
            technicianValidated: false,
          },
          proposal: {
            candidateId: onlyCandidate.id,
            explanation: 'Clasificacion espacial unica con comprobacion documental pendiente.',
            confidence: 'medium',
            requiresProfessionalReview: true,
          },
          reviewReasons: ['instrument_traceability_pending'],
        })}
      />
    );

    expect(screen.getByText(/Clasificaci.n probable/i)).toBeTruthy();
    expect(screen.getAllByText(/comprobaci.n documental pendiente/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/varios .mbitos urban.sticos/i)).toBeNull();
  });

  it('presenta varias intersecciones como ámbitos reales y conserva todos los candidatos', () => {
    render(<ClassificationResolutionPanel resolution={resolution()} />);
    expect(screen.getByText(/intersecta varios ámbitos urbanísticos/i)).toBeTruthy();
    expect(screen.getAllByText('Clasificación SU')[0]).toBeTruthy();
    expect(screen.getAllByText('Clasificación SNR')[0]).toBeTruthy();
    expect(screen.getAllByText(/Superficie intersectada:/i)).toHaveLength(2);
    expect(screen.getByText(/60.*% de la parcela/i)).toBeTruthy();
    expect(screen.getByText(/40.*% de la parcela/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ver en Catastro/i })).toBeTruthy();
  });

  it('explica la discrepancia, identifica la propuesta y permite cambiar la selección', () => {
    const onSelect = vi.fn();
    const first = candidate('geometry', 'SNR', 'SNRSC');
    render(
      <ClassificationResolutionPanel
        resolution={resolution({
          status: 'review_required',
          nextAction: 'review_official_sources',
          candidates: [first],
          proposal: {
            candidateId: first.id,
            explanation: 'Se prioriza la geometría completa.',
            confidence: 'high',
            requiresProfessionalReview: true,
          },
          discrepancies: [
            {
              reason: 'point_geometry_mismatch',
              field: 'classification',
              explanation: 'El punto y la geometría no coinciden.',
              assertions: [
                { candidateId: first.id, value: 'SNR/SNRSC', source: 'siotuga', evidence: [evidence] },
              ],
            },
          ],
          reviewReasons: ['point_geometry_mismatch'],
        })}
        onSelectCandidate={onSelect}
      />
    );

    expect(screen.getByText(/requiere revisión profesional/i)).toBeTruthy();
    expect(screen.getByText(/El punto y la geometría no coinciden/i)).toBeTruthy();
    expect(
      screen.getByText(/El punto representativo y la geometría completa/i)
    ).toBeTruthy();
    expect(screen.getByText(/Propuesta de UrbanBrain/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Usar como selección manual/i }));
    expect(onSelect).toHaveBeenCalledWith(first);
  });

  it('diferencia una fuente no disponible de una respuesta sin clasificación', () => {
    const { rerender } = render(
      <ClassificationResolutionPanel
        resolution={resolution({
          status: 'source_unavailable',
          nextAction: 'retry_source',
          candidates: [],
        })}
      />
    );
    expect(screen.getByText(/No se pudo completar la consulta oficial/i)).toBeTruthy();

    rerender(
      <ClassificationResolutionPanel
        resolution={resolution({
          status: 'not_available',
          nextAction: 'manual_selection',
          candidates: [],
        })}
      />
    );
    expect(screen.getByText(/no ofrecen una clasificación suficiente/i)).toBeTruthy();
  });

  it('identifica la categoría predominante e intersección secundaria en una parcela multicategoría descompensada (98,53 % / 1,47 %)', () => {
    const candidateSnrc: ClassificationCandidate = {
      ...candidate('c-snrc', 'SNR', 'SNRC'),
      kind: 'official_classification' as const,
      source: 'siotuga' as const,
      classification: {
        code: 'SNR',
        categoryCode: 'SNRC',
        label: 'Suelo de núcleo rural',
        categoryLabel: 'Núcleo rural común',
        sourceFeatureIds: ['c-snrc'],
      },
      parcelCoverage: {
        parcelAreaSquareMetres: 1790.46,
        intersectionAreaSquareMetres: 1764.22,
        parcelPercentage: 98.53,
        method: 'polygon_intersection',
      },
    };

    const candidateSnrt: ClassificationCandidate = {
      ...candidate('c-snrt', 'SNR', 'SNRT'),
      kind: 'official_classification' as const,
      source: 'siotuga' as const,
      classification: {
        code: 'SNR',
        categoryCode: 'SNRT',
        label: 'Suelo de núcleo rural',
        categoryLabel: 'Núcleo rural tradicional',
        sourceFeatureIds: ['c-snrt'],
      },
      parcelCoverage: {
        parcelAreaSquareMetres: 1790.46,
        intersectionAreaSquareMetres: 26.24,
        parcelPercentage: 1.47,
        method: 'polygon_intersection',
      },
    };

    render(
      <ClassificationResolutionPanel
        resolution={resolution({
          candidates: [candidateSnrc, candidateSnrt],
        })}
      />
    );

    expect(screen.getAllByText('Suelo de núcleo rural · Núcleo rural común')[0]).toBeTruthy();
    expect(screen.getAllByText('Suelo de núcleo rural · Núcleo rural tradicional')[0]).toBeTruthy();
    expect(screen.getByText('Predominante')).toBeTruthy();
    expect(screen.getByText('Intersección secundaria')).toBeTruthy();
    expect(screen.getAllByText(/1764,22/)[0]).toBeTruthy();
    expect(screen.getAllByText(/98,53/)[0]).toBeTruthy();
    expect(screen.getAllByText(/26,24/)[0]).toBeTruthy();
    expect(screen.getAllByText(/1,47/)[0]).toBeTruthy();
  });

  it('identifica la categoría predominante e intersección secundaria en categorías próximas (55 % / 45 %)', () => {
    const candidate55: ClassificationCandidate = {
      ...candidate('c-55', 'SU', 'SUC'),
      kind: 'official_classification' as const,
      source: 'siotuga' as const,
      classification: {
        code: 'SU',
        categoryCode: 'SUC',
        label: 'Suelo urbano',
        categoryLabel: 'Suelo urbano consolidado',
        sourceFeatureIds: ['c-55'],
      },
      parcelCoverage: {
        parcelAreaSquareMetres: 1000,
        intersectionAreaSquareMetres: 550,
        parcelPercentage: 55,
        method: 'polygon_intersection',
      },
    };

    const candidate45: ClassificationCandidate = {
      ...candidate('c-45', 'SU', 'SUNC'),
      kind: 'official_classification' as const,
      source: 'siotuga' as const,
      classification: {
        code: 'SU',
        categoryCode: 'SUNC',
        label: 'Suelo urbano',
        categoryLabel: 'Suelo urbano no consolidado',
        sourceFeatureIds: ['c-45'],
      },
      parcelCoverage: {
        parcelAreaSquareMetres: 1000,
        intersectionAreaSquareMetres: 450,
        parcelPercentage: 45,
        method: 'polygon_intersection',
      },
    };

    render(
      <ClassificationResolutionPanel
        resolution={resolution({
          candidates: [candidate55, candidate45],
        })}
      />
    );

    expect(screen.getByText('Predominante')).toBeTruthy();
    expect(screen.getByText('Intersección secundaria')).toBeTruthy();
    expect(screen.getByText(/55 % de la parcela/)).toBeTruthy();
    expect(screen.getByText(/45 % de la parcela/)).toBeTruthy();
  });

  it('no muestra distintivo de predominante cuando la parcela tiene una única categoría', () => {
    const single: ClassificationCandidate = {
      ...candidate('c-single', 'SU', 'SUC'),
      kind: 'official_classification' as const,
      source: 'siotuga' as const,
      classification: {
        code: 'SU',
        categoryCode: 'SUC',
        label: 'Suelo urbano',
        categoryLabel: 'Suelo urbano consolidado',
        sourceFeatureIds: ['c-single'],
      },
      parcelCoverage: {
        parcelAreaSquareMetres: 1000,
        intersectionAreaSquareMetres: 1000,
        parcelPercentage: 100,
        method: 'polygon_intersection',
      },
    };

    render(
      <ClassificationResolutionPanel
        resolution={resolution({
          status: 'clear',
          candidates: [single],
        })}
      />
    );

    expect(screen.queryByText('Predominante')).toBeNull();
    expect(screen.queryByText('Intersección secundaria')).toBeNull();
  });
});
