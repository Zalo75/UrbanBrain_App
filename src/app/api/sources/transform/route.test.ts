import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getExpedienteAccess: vi.fn(),
  transformSource: vi.fn(),
  getExistingDerivationsForSource: vi.fn(),
}));

vi.mock('@/application/authorization/expedienteAccess', () => ({
  getExpedienteAccess: mocks.getExpedienteAccess,
}));

vi.mock('@/application/document-reading/sourceTransformationEngine', () => ({
  transformSource: mocks.transformSource,
  getExistingDerivationsForSource: mocks.getExistingDerivationsForSource,
}));

import { GET, POST } from './route';

describe('/api/sources/transform route handler', () => {
  const expedienteId = 'ae89c191-f126-49e5-8404-a43148648290';
  const sourceRef = 'instrument-document:46722:chunk:c18e787e3bedebda_00024';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('devuelve 401 Unauthorized cuando el usuario no está autenticado', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
    });

    const req = new NextRequest('http://localhost:3000/api/sources/transform', {
      method: 'POST',
      body: JSON.stringify({
        expedienteId,
        sourceRef,
        derivationType: 'ocr_correction',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(mocks.transformSource).not.toHaveBeenCalled();
  });

  it('devuelve 404 Not found cuando el usuario no está autorizado (otro expediente / otro usuario)', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: false,
      reason: 'not_found_or_forbidden',
    });

    const req = new NextRequest('http://localhost:3000/api/sources/transform', {
      method: 'POST',
      body: JSON.stringify({
        expedienteId,
        sourceRef,
        derivationType: 'ocr_correction',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Not found' });
    expect(mocks.transformSource).not.toHaveBeenCalled();
  });

  it.each(['planning:evidence', 'synthetic:summary-layer'])(
    'rechaza de forma fail-closed la fuente sintética %s antes de autenticación o transformación',
    async (syntheticSourceRef) => {
      const req = new NextRequest('http://localhost:3000/api/sources/transform', {
        method: 'POST',
        body: JSON.stringify({
          expedienteId,
          sourceRef: syntheticSourceRef,
          derivationType: 'translation',
          targetLanguage: 'es',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toEqual({
        error: 'Las fuentes sintéticas de planeamiento no admiten transformaciones.',
      });
      expect(mocks.getExpedienteAccess).not.toHaveBeenCalled();
      expect(mocks.transformSource).not.toHaveBeenCalled();
    }
  );

  it('devuelve 422 FAIL CLOSED cuando la fuente solicitada no está acreditada en el expediente', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'af97677f-8ee6-4a3d-82a0-b907c6010957',
      orgId: 'org-1',
      membershipRole: 'owner',
      expediente: { id: expedienteId },
    });

    mocks.transformSource.mockRejectedValue(
      new Error('FAIL_CLOSED_NOT_ACCREDITED: No se pudo resolver la fuente acreditada en este expediente.')
    );

    const req = new NextRequest('http://localhost:3000/api/sources/transform', {
      method: 'POST',
      body: JSON.stringify({
        expedienteId,
        sourceRef: 'unaccredited-source-999',
        derivationType: 'ocr_correction',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({
      error: 'La fuente solicitada no está acreditada en este expediente.',
    });
  });

  it('devuelve 200 con resultado determinista cuando el usuario ejecuta OCR local', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'af97677f-8ee6-4a3d-82a0-b907c6010957',
      orgId: 'org-1',
      membershipRole: 'owner',
      expediente: { id: expedienteId },
    });

    const mockDerivation = {
      id: 'deriv-123',
      expedienteId,
      sourceRef,
      sourceHash: 'hash-abc',
      derivationType: 'ocr_correction',
      sourceLanguage: 'auto',
      targetLanguage: null,
      translationSource: null,
      inputDerivationId: null,
      inputDerivationHash: null,
      derivedText: 'Texto limpio sin defectos de OCR.',
      model: 'deterministic-ocr-cleaner-v1',
      provider: 'local',
      createdAt: '2026-09-19T10:00:00.000Z',
    };

    mocks.transformSource.mockResolvedValue({
      derivation: mockDerivation,
      fromCache: false,
    });

    const req = new NextRequest('http://localhost:3000/api/sources/transform', {
      method: 'POST',
      body: JSON.stringify({
        expedienteId,
        sourceRef,
        derivationType: 'ocr_correction',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      derivation: mockDerivation,
      fromCache: false,
    });
    expect(mocks.transformSource).toHaveBeenCalledWith({
      expedienteId,
      sourceRef,
      derivationType: 'ocr_correction',
      targetLanguage: undefined,
    });
  });

  it('devuelve 200 con traducción asistida cuando el usuario solicita traducción a gallego', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'af97677f-8ee6-4a3d-82a0-b907c6010957',
      orgId: 'org-1',
      membershipRole: 'owner',
      expediente: { id: expedienteId },
    });

    const mockTranslation = {
      id: 'deriv-trans-456',
      expedienteId,
      sourceRef,
      sourceHash: 'hash-abc',
      derivationType: 'translation',
      sourceLanguage: 'auto',
      targetLanguage: 'gl',
      translationSource: 'ocr_correction',
      inputDerivationId: 'deriv-123',
      inputDerivationHash: 'hash-clean',
      derivedText: 'Texto traducido ao galego con fidelidade documental.',
      model: 'local-ct2',
      provider: 'local',
      createdAt: '2026-09-19T10:05:00.000Z',
    };

    mocks.transformSource.mockResolvedValue({
      derivation: mockTranslation,
      fromCache: false,
    });

    const req = new NextRequest('http://localhost:3000/api/sources/transform', {
      method: 'POST',
      body: JSON.stringify({
        expedienteId,
        sourceRef,
        derivationType: 'translation',
        targetLanguage: 'gl',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      derivation: mockTranslation,
      fromCache: false,
    });
    expect(mocks.transformSource).toHaveBeenCalledWith({
      expedienteId,
      sourceRef,
      derivationType: 'translation',
      targetLanguage: 'gl',
    });
  });

  it('devuelve 503 cuando el proveedor de transformación no está configurado', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'af97677f-8ee6-4a3d-82a0-b907c6010957',
      orgId: 'org-1',
      membershipRole: 'owner',
      expediente: { id: expedienteId },
    });

    mocks.transformSource.mockRejectedValue(
      new Error('PROVIDER_NOT_CONFIGURED: Servicio de transformación documental no configurado.')
    );

    const req = new NextRequest('http://localhost:3000/api/sources/transform', {
      method: 'POST',
      body: JSON.stringify({
        expedienteId,
        sourceRef,
        derivationType: 'translation',
        targetLanguage: 'gl',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Servicio de transformación documental no configurado.',
    });
  });

  it('GET devuelve 200 con derivaciones existentes para usuario autorizado', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'af97677f-8ee6-4a3d-82a0-b907c6010957',
      orgId: 'org-1',
      membershipRole: 'owner',
      expediente: { id: expedienteId },
    });

    const mockDerivations = [
      {
        id: 'deriv-123',
        expedienteId,
        sourceRef,
        sourceHash: 'hash-abc',
        derivationType: 'ocr_correction',
        derivedText: 'Texto limpio.',
        model: 'deterministic-ocr-cleaner-v1',
        provider: 'local',
        createdAt: '2026-09-19T10:00:00.000Z',
      },
      {
        id: 'deriv-trans-456',
        expedienteId,
        sourceRef,
        sourceHash: 'hash-abc',
        derivationType: 'translation',
        targetLanguage: 'gl',
        derivedText: 'Texto traducido ao galego.',
        model: 'local-ct2',
        provider: 'local',
        createdAt: '2026-09-19T10:05:00.000Z',
      },
    ];

    mocks.getExistingDerivationsForSource.mockResolvedValue(mockDerivations);

    const req = new NextRequest(
      `http://localhost:3000/api/sources/transform?expedienteId=${expedienteId}&sourceRef=${encodeURIComponent(sourceRef)}`
    );

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ derivations: mockDerivations });
    expect(mocks.getExistingDerivationsForSource).toHaveBeenCalledWith(expedienteId, sourceRef, undefined);
  });
});
