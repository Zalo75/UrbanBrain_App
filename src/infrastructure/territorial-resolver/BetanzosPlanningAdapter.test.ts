import { describe, expect, it, vi } from 'vitest';

import type { PlanningPort } from '@/domain/territorial-resolver/types';
import { BETANZOS_REGISTRY } from '@/municipal-pilots/betanzos/registry';
import { BetanzosPlanningAdapter } from './BetanzosPlanningAdapter';

const NOW = new Date('2026-07-14T10:00:00.000Z');

function fallback(): PlanningPort {
  return {
    findApplicablePlanning: vi.fn(async () => ({
      status: 'not_determined',
      evidence: [],
      warnings: [{ code: 'fallback', message: 'fallback' }],
    })),
  };
}

describe('BetanzosPlanningAdapter', () => {
  it('mantiene un registro versionado sin identificadores duplicados ni históricos vigentes', () => {
    const ids = BETANZOS_REGISTRY.instruments.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BETANZOS_REGISTRY.instruments.filter((item) => item.status === 'current')).toHaveLength(
      1
    );
    expect(BETANZOS_REGISTRY.instruments.find((item) => item.id === '26373')?.status).toBe(
      'historical'
    );
  });

  it('aporta únicamente instrumento, documentos y limitaciones del registro municipal', async () => {
    const result = await new BetanzosPlanningAdapter(fallback(), () => NOW).findApplicablePlanning({
      municipalityCode: '15009',
      coordinates: { lat: 43.28, lng: -8.26 },
    });

    expect(result.status).toBe('partial');
    expect(result.instrument).toContain('Normas Subsidiarias');
    expect(result.classification).toBeUndefined();
    expect(result.classificationResolution).toBeUndefined();
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ source: 'siotuga', scope: 'planning_instrument' })
    );
    expect(result.warnings.map((item) => item.code)).toContain('point_only_planning_analysis');
  });

  it('no presenta como aplicable una modificación que carece de vínculo espacial', async () => {
    const result = await new BetanzosPlanningAdapter(fallback(), () => NOW).findApplicablePlanning({
      municipalityCode: '15009',
    });

    expect(result.applicableInstruments?.map((item) => item.id)).toEqual(['22221']);
    expect(result.cataloguedInstruments?.map((item) => item.id)).toContain('28550');
    expect(result.cataloguedInstruments?.map((item) => item.id)).not.toContain('23087');
  });

  it('delega cualquier otro municipio sin alterar el resultado', async () => {
    const delegated = fallback();
    await new BetanzosPlanningAdapter(delegated).findApplicablePlanning({
      municipalityCode: '15030',
      coordinates: { lat: 43.37, lng: -8.4 },
    });
    expect(delegated.findApplicablePlanning).toHaveBeenCalledWith({
      municipalityCode: '15030',
      coordinates: { lat: 43.37, lng: -8.4 },
    });
  });
});
