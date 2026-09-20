import { vi } from 'vitest';
import { ArcGisDetailedZoningStrategy } from './ArcGisDetailedZoningStrategy';
import { ArcGisUniversalZoningAdapter, type MinimalLLMClient } from './ArcGisUniversalZoningAdapter';
import type { DetailedZoningStrategyContext } from '@/application/territorial-resolver/ordinanceCandidateResolver';
import type { ParcelGeometry } from '@/domain/territorial-resolver/types';

describe('ArcGisDetailedZoningStrategy', () => {
  let adapter: ArcGisUniversalZoningAdapter;
  let mockContext: DetailedZoningStrategyContext;
  
  const mockGeometry: ParcelGeometry = {
    type: 'MultiPolygon',
    coordinates: [[[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]]
  };

  beforeEach(() => {
    // Stub the adapter's actual execution, we already tested it in ArcGisUniversalZoningAdapter.test.ts
    adapter = new ArcGisUniversalZoningAdapter({ client: {} as MinimalLLMClient });
    
    mockContext = {
      planning: {
        status: 'determined',
        instrument: 'test-instrument-123',
        evidence: [],
        warnings: []
      },
      geometry: mockGeometry
    };
  });

  it('A) should map a simple ZoningIdentity to a correct DetailedZoningObservation', async () => {
    vi.spyOn(adapter, 'resolveZoning').mockResolvedValueOnce([{
      code: 'U-1',
      label: 'Residencial',
      sourceType: 'arcgis_featureserver',
      sourceUrl: 'https://test.com/0',
      layerId: 0,
      rawAttributes: { cod: 'U-1' },
      confidence: 'high',
      evidence: ['Test evidence']
    }]);

    const strategy = new ArcGisDetailedZoningStrategy(adapter, () => [{ url: 'https://test.com/0' }]);
    const result = await strategy.resolve(mockContext);

    expect(result).toHaveLength(1);
    expect(result[0].identity).toBe('U-1');
    expect(result[0].instrumentId).toBe('test-instrument-123');
    expect(result[0].sourceRef).toBe('https://test.com/0');
    expect(result[0].provenance).toEqual(['Test evidence']);
    expect(result[0].confidence).toBe('high');
  });

  it('B) should handle multiple identities (multizone mapping)', async () => {
    vi.spyOn(adapter, 'resolveZoning').mockResolvedValueOnce([
      {
        code: 'U-1',
        label: 'Residencial',
        sourceType: 'arcgis',
        sourceUrl: 'https://test.com/0',
        layerId: 0,
        rawAttributes: {},
        confidence: 'high',
        evidence: []
      },
      {
        code: 'U-8',
        label: 'Terciario',
        sourceType: 'arcgis',
        sourceUrl: 'https://test.com/0',
        layerId: 0,
        rawAttributes: {},
        confidence: 'medium',
        evidence: []
      }
    ]);

    const strategy = new ArcGisDetailedZoningStrategy(adapter, () => [{ url: 'https://test.com/0' }]);
    const result = await strategy.resolve(mockContext);

    expect(result).toHaveLength(2);
    expect(result[0].identity).toBe('U-1');
    expect(result[1].identity).toBe('U-8');
    expect(result[1].confidence).toBe('medium');
  });

  it('C) should fail safe and not block the pipeline if adapter is unresolved', async () => {
    vi.spyOn(adapter, 'resolveZoning').mockResolvedValueOnce([{
      code: null,
      label: null,
      sourceType: 'arcgis',
      sourceUrl: 'https://test.com/0',
      layerId: null,
      rawAttributes: { _status: 'unresolved', _error: 'No layers' },
      confidence: 'low',
      evidence: ['No layers']
    }]);

    const strategy = new ArcGisDetailedZoningStrategy(adapter, () => [{ url: 'https://test.com/0' }]);
    const result = await strategy.resolve(mockContext);

    expect(result).toHaveLength(0); // Gracefully returns empty array so other strategies run
  });

  it('C) should fail safe if URL extractor returns undefined', async () => {
    const strategy = new ArcGisDetailedZoningStrategy(adapter, () => undefined);
    const result = await strategy.resolve(mockContext);

    expect(result).toHaveLength(0);
  });

  it('C) should fail safe if geometry is missing or invalid', async () => {
    const strategy = new ArcGisDetailedZoningStrategy(adapter, () => [{ url: 'https://test.com' }]);
    mockContext.geometry = { type: 'Point', coordinates: [0, 0] }; // Invalid for our adapter
    
    const result = await strategy.resolve(mockContext);
    expect(result).toHaveLength(0);
  });

  it('C) should fail safe if adapter throws an unhandled exception', async () => {
    vi.spyOn(adapter, 'resolveZoning').mockRejectedValueOnce(new Error('Network Crash'));
    
    const strategy = new ArcGisDetailedZoningStrategy(adapter, () => [{ url: 'https://test.com/0' }]);
    const result = await strategy.resolve(mockContext);

    expect(result).toHaveLength(0); // Caught exception safely
  });
});
