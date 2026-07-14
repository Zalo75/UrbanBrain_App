import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./territorialActions', () => ({
  resolveTerritorialContextAction: vi.fn(async () => ({ status: 'success', message: 'ok' })),
}));

import { TerritorialContextPanel } from './TerritorialContextPanel';

describe('TerritorialContextPanel', () => {
  it('ofrece las tres entradas sin permitir introducir municipio', () => {
    render(<TerritorialContextPanel expedienteId="exp-a" initialInput={{}} context={null} />);

    expect(screen.getByLabelText('Referencia catastral')).toBeTruthy();
    expect(screen.getByLabelText('Latitud')).toBeTruthy();
    expect(screen.getByLabelText('Longitud')).toBeTruthy();
    expect(screen.getByLabelText('Dirección')).toBeTruthy();
    expect(screen.queryByLabelText('Municipio')).toBeNull();
  });

  it('distingue un contexto conflictivo y muestra la cobertura parcial', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={{
          status: 'conflict',
          confidence: 'high',
          resolvedAt: '2026-07-14T00:00:00.000Z',
          inputMethod: 'coordinates',
          municipality: 'Betanzos',
          municipalityCode: '15009',
          areas: ['Núcleo'],
          affects: [],
          conflicts: ['El punto y la parcela no coinciden.'],
          warnings: [],
          sources: [],
          canAnswerConcreteParameters: false,
          canRuleOutUndetectedAffects: false,
          candidateCount: 0,
        }}
      />
    );

    expect(screen.getByText('Conflictivo')).toBeTruthy();
    expect(screen.getByText(/no demuestra ausencia de otras afecciones/i)).toBeTruthy();
    expect(screen.getByText(/se abstendrá de dar parámetros/i)).toBeTruthy();
  });
});
