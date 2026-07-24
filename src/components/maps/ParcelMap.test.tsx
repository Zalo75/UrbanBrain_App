import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderedLeafletProps = vi.hoisted(() => vi.fn());

vi.mock('next/dynamic', () => ({
  default: () =>
    function MockLeafletParcelMap(props: unknown) {
      renderedLeafletProps(props);
      return <div data-testid="leaflet-map" />;
    },
}));

import type { ParcelGeometry } from '@/domain/territorial-resolver/types';
import { ParcelMap } from './ParcelMap';

const geometry: ParcelGeometry = {
  type: 'MultiPolygon',
  crs: 'EPSG:4326',
  coordinates: [
    [[[-8.218, 43.271], [-8.217, 43.272], [-8.216, 43.271], [-8.218, 43.271]]],
  ],
};

describe('ParcelMap', () => {
  beforeEach(() => {
    renderedLeafletProps.mockClear();
  });

  it('mantiene la parcela al cambiar únicamente la capa base', () => {
    render(<ParcelMap geometry={geometry} coordinates={{ lat: 43.271, lng: -8.217 }} />);

    expect(renderedLeafletProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ geometry, baseLayerId: 'catastro' })
    );
    fireEvent.change(screen.getByLabelText('Capa base'), { target: { value: 'pnoa' } });
    expect(renderedLeafletProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ geometry, baseLayerId: 'pnoa' })
    );
  });

  it('marca la ubicación aproximada, formatea y copia las coordenadas', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<ParcelMap coordinates={{ lat: 43.270567277, lng: -8.216584724 }} />);

    expect(screen.getByText(/Ubicación aproximada/i)).toBeTruthy();
    expect(screen.getByText('43.270567')).toBeTruthy();
    expect(screen.getByText('-8.216585')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar coordenadas' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('43.270567, -8.216585');
    });
    expect(screen.getByRole('button', { name: 'Coordenadas copiadas' })).toBeTruthy();
  });

  it('muestra un estado vacío sin inicializar el mapa', () => {
    render(<ParcelMap />);

    expect(screen.getByText(/No hay una ubicación disponible/i)).toBeTruthy();
    expect(screen.queryByTestId('leaflet-map')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copiar coordenadas' }).hasAttribute('disabled')).toBe(
      true
    );
  });

  it('explica el fallo si el navegador no permite copiar', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    render(<ParcelMap coordinates={{ lat: 43.27, lng: -8.21 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar coordenadas' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudieron copiar/i);
  });
});
