import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getExpedienteAccess: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  detectContext: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/application/authorization/expedienteAccess', () => ({
  getExpedienteAccess: mocks.getExpedienteAccess,
}));
vi.mock('@/infrastructure/db/client', () => ({ db: { update: mocks.update } }));
vi.mock('@/application/context-engine/ContextDetectionEngine', () => ({
  ContextDetectionEngine: class {
    detectContext = mocks.detectContext;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { resolveTerritorialContextAction } from './territorialActions';

describe('resolveTerritorialContextAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.where.mockResolvedValue(undefined);
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'user-a',
      orgId: 'org-a',
      expediente: { id: 'exp-a', orgId: 'org-a' },
    });
    mocks.detectContext.mockResolvedValue({ status: 'confirmed' });
  });

  it('no resuelve ni escribe un expediente no autorizado', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: false,
      reason: 'not_found_or_forbidden',
    });
    const form = new FormData();
    form.set('refCatastral', '1234567NH4913S');

    const result = await resolveTerritorialContextAction(
      'exp-b',
      { status: 'idle', message: '' },
      form
    );

    expect(result.status).toBe('error');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.detectContext).not.toHaveBeenCalled();
  });

  it('persiste sólo entradas de localización y vuelve a autorizar antes de resolver', async () => {
    const form = new FormData();
    form.set('refCatastral', '1234567-nh-4913-s');
    form.set('lat', '43.3');
    form.set('lng', '-8.2');
    form.set('address', 'Dirección orientativa');
    form.set('municipio', 'municipio-manipulado');

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    );

    expect(result.status).toBe('success');
    expect(mocks.set).toHaveBeenCalledWith({
      refCatastral: '1234567NH4913S',
      address: 'Dirección orientativa',
      lat: 43.3,
      lng: -8.2,
      location: [-8.2, 43.3],
      locationSource: 'cadastral_reference',
      contextoValidadoPorTecnico: false,
    });
    expect(mocks.detectContext).toHaveBeenCalledWith('exp-a', 'user-a');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/expedientes/exp-a');
  });

  it('permite resolver sólo con coordenadas WGS84', async () => {
    const form = new FormData();
    form.set('lat', '43.3');
    form.set('lng', '-8.2');

    await resolveTerritorialContextAction('exp-a', { status: 'idle', message: '' }, form);

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        refCatastral: null,
        lat: 43.3,
        lng: -8.2,
        locationSource: 'coordinates',
      })
    );
  });

  it('conserva la revisión técnica sólo al repetir exactamente la misma localización', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'user-a',
      orgId: 'org-a',
      expediente: {
        id: 'exp-a',
        orgId: 'org-a',
        refCatastral: '1234567NH4913S',
        address: null,
        lat: null,
        lng: null,
        contextoValidadoPorTecnico: true,
      },
    });
    const form = new FormData();
    form.set('refCatastral', '1234567NH4913S');

    await resolveTerritorialContextAction('exp-a', { status: 'idle', message: '' }, form);

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ contextoValidadoPorTecnico: true })
    );
  });
});
