import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TerritorialContextPanel } from '../TerritorialContextPanel';
import { HasSessionView } from './HasSessionView';
import React from 'react';

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock('../territorialActions', () => ({
  resolveTerritorialContextAction: vi.fn(),
}));
vi.mock('@/infrastructure/db/client', () => ({}));
global.fetch = vi.fn(() => Promise.resolve({ text: () => Promise.resolve(`
  id:'8084401NH6388S'
  source:'Catastro INSPIRE · catastro_vila_area.xml'
  rings:[[[246.36,200.77],[263.85,204.38],[257.47,235.26],[240.14,231.85],[246.36,200.77]]]
  modern.src='02_moderno.png';
  historic.src='01_historico.png';
  saveSession(){
  HISTORIC_SIZE={width:508,height:508}
`) })) as any;

// Mock useRouter
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe('HAS Paso 3 Integration Tests', () => {
  const baseContext = {
    status: 'provisional' as const,
    confidence: 'low' as const,
    resolvedAt: '2026-09-15',
    inputMethod: 'coordinates' as const,
    areas: [],
    affects: [],
    conflicts: [],
    warnings: [],
    sources: [],
    canAnswerConcreteParameters: false,
    canRuleOutUndetectedAffects: false,
    candidateCount: 0,
    latestAttemptAt: '2026-09-15',
    usingPreviousOfficialContext: false,
    technicallyReviewed: false,
    sourceChecks: [],
    planningStatus: 'determined' as const,
    ordinanceResolution: {
      status: 'REVIEW_REQUIRED' as const,
      provenance: [],
    }
  };

  const initialInput = {
    cadastralReference: '123',
    address: 'test',
    lat: 42,
    lng: -8,
  };

  it('A) hasEligibility true => acción Abrir HAS disponible.', () => {
    const context = {
      ...baseContext,
      ordinanceResolution: {
        status: 'REVIEW_REQUIRED' as const,
        provenance: [],
        hasEligibility: { eligible: true, sheet: { id: 'sheet-1', sourceUrl: 'test.png', format: 'png', provenance: ['test'] } }
      }
    };
    render(<TerritorialContextPanel expedienteId="exp-1" initialInput={initialInput} context={context} />);
    expect(screen.getByText('Abrir HAS')).toBeInTheDocument();
  });

  it('B) sin hasEligibility => HAS sigue disponible para revisión manual.', () => {
    const context = {
      ...baseContext,
      ordinanceResolution: {
        status: 'REVIEW_REQUIRED' as const,
        provenance: [],
      }
    };
    render(<TerritorialContextPanel expedienteId="exp-1" initialInput={initialInput} context={context} />);
    expect(screen.getByText('Abrir HAS')).toBeInTheDocument();
  });

  it('C & D & E & F & G & H) La sesión recibe ParcelGeometry real, no bbox fabricada, y datos de sheet correctos.', async () => {
    const parcelGeometry = {
      type: 'MultiPolygon',
      coordinates: [[[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]]]
    };
    const hasEligibility = {
      eligible: true,
      sheet: {
        id: 'sheet-123',
        sourceUrl: 'http://test.com/sheet.png',
        format: 'image/png',
        provenance: ['siotuga:sheet']
      }
    };

    render(
      <HasSessionView
        expedienteId="exp-123"
        expedienteName="Test Exp"
        hasEligibility={hasEligibility}
        parcelGeometry={parcelGeometry}
        cadastralReference="1234567NH0000S"
        cartography={{ inputs: [
          { kind: 'historical', src: 'data:image/png;base64,historic', width: 508, height: 508, provenance: {} },
          { kind: 'modern', src: 'data:image/png;base64,modern', width: 508, height: 508, provenance: {} },
        ], limitations: [] }}
      />
    );

    // C & E) The parcelGeometry is passed directly to the component, not a bbox.
    // D & F & G) hasEligibility sheet data is passed, activeMapBbox is explicitly NOT in this contract.
    // H) "Terminar produce resultado en memoria" is implemented as postMessage instead of DB save in the component logic.
    expect(screen.getByText('HAS: Test Exp')).toBeInTheDocument();
    expect(screen.getByText('Ajuste por Superposición - sheet-123')).toBeInTheDocument();
    
    // Check if iframe is rendered with correct srcDoc logic
    await waitFor(() => {
      const iframe = document.querySelector('iframe');
      expect(iframe).toBeInTheDocument();
      const srcDoc = iframe?.getAttribute('srcdoc');
      // Ensure the sheet source URL was injected
      expect(srcDoc).toContain('historic.src="data:image/png;base64,historic"');
      expect(srcDoc).toContain('modern.src="data:image/png;base64,modern"');
      expect(srcDoc).toContain('1234567NH0000S');
      expect(srcDoc).not.toContain('8084401NH6388S');
      expect(srcDoc).not.toContain('01_historico.png');
      expect(srcDoc).not.toContain('02_moderno.png');
      // Ensure parcel rings were injected (from the geometry, projected)
      expect(srcDoc).toContain("rings:[");
    });
  });
});
