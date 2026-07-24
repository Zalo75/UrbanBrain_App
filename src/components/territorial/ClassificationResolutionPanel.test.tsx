import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  ClassificationCandidate,
  ClassificationResolution,
} from '@/domain/territorial-resolver/types';
import { ClassificationResolutionPanel } from './ClassificationResolutionPanel';

const evidence = {
  source: 'siotuga' as const,
  sourceUrl: 'https://siotuga.xunta.gal/official',
  retrievedAt: '2026-07-24T10:00:00.000Z',
  method: 'WFS oficial',
  scope: 'planning_classification' as const,
};

function candidate(id: string, code: string, category: string): ClassificationCandidate {
  return {
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
  it('presenta varias intersecciones como ámbitos reales y conserva todos los candidatos', () => {
    render(<ClassificationResolutionPanel resolution={resolution()} />);
    expect(screen.getByText(/intersecta varios ámbitos urbanísticos/i)).toBeTruthy();
    expect(screen.getByText('Clasificación SU')).toBeTruthy();
    expect(screen.getByText('Clasificación SNR')).toBeTruthy();
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
});
