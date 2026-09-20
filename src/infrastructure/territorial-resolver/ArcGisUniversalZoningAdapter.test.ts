import { ArcGisUniversalZoningAdapter, type MinimalLLMClient } from './ArcGisUniversalZoningAdapter';
import type { ParcelGeometry } from '@/domain/territorial-resolver/types';

// Mock OpenAI using MinimalLLMClient
class MockOpenAI implements MinimalLLMClient {
  chat = {
    completions: {
      create: async (req: { messages: Array<{ content: string }> }) => {
        const payloadStr = req.messages[1].content;
        
        // Match TEO
        if (payloadStr.includes('cod') && payloadStr.includes('ordenanza')) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  IS_DETAILED_ZONING_LAYER: 'YES',
                  LAYER_ID: 0,
                  LAYER_NAME: 'Ordenanzas',
                  IDENTITY_FIELDS: ['cod'],
                  LABEL_FIELDS: ['ordenanza'],
                  PARAMETER_FIELDS: [],
                  SEMANTIC_DIMENSION: 'ordinance',
                  RATIONALE: 'Mocked Teo Rationale'
                })
              }
            }]
          };
        }
        
        // Match POIO
        if (payloadStr.includes('TIPO') && payloadStr.includes('DENOM')) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  IS_DETAILED_ZONING_LAYER: 'YES',
                  LAYER_ID: 1,
                  LAYER_NAME: 'Zonificacion',
                  IDENTITY_FIELDS: ['TIPO'],
                  LABEL_FIELDS: ['DENOM'],
                  PARAMETER_FIELDS: ['CATEG'],
                  RATIONALE: 'Mocked Poio Rationale'
                })
              }
            }]
          };
        }

        return {
          choices: [{
            message: {
              content: JSON.stringify({
                IS_DETAILED_ZONING_LAYER: 'NO',
                LAYER_ID: null,
                LAYER_NAME: null,
                IDENTITY_FIELDS: [],
                LABEL_FIELDS: [],
                PARAMETER_FIELDS: [],
                RATIONALE: 'Not a detailed zoning layer'
              })
            }
          }]
        };
      }
    }
  };
}

// Mock Fetch
const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = async (url: string | Request | URL) => {
    const urlStr = url.toString();
    
    // TEO Mocks
    if (urlStr.includes('PXOM_201006_AD_4ORDSUC_00Ordenanzas_VP/FeatureServer/0?f=json')) {
      return new Response(JSON.stringify({
        id: 0,
        name: 'Ordenanzas TEO',
        type: 'Feature Layer',
        geometryType: 'esriGeometryPolygon',
        fields: [
          { name: 'cod', type: 'esriFieldTypeString', alias: 'cod' },
          { name: 'ordenanza', type: 'esriFieldTypeString', alias: 'ordenanza' }
        ]
      }));
    }
    
    if (urlStr.includes('PXOM_201006_AD_4ORDSUC_00Ordenanzas_VP/FeatureServer/0/query')) {
      return new Response(JSON.stringify({
        features: [
          { attributes: { cod: 'U-1', ordenanza: 'Residencial U-1' } },
          { attributes: { cod: 'U-8', ordenanza: 'Terciario U-8' } }
        ]
      }));
    }

    // POIO Mocks
    if (urlStr.includes('POIO_ZONING/FeatureServer/layers?f=json')) {
      return new Response(JSON.stringify({
        layers: [{
          id: 1,
          name: 'Zonificacion POIO',
          type: 'Feature Layer',
          geometryType: 'esriGeometryPolygon',
          fields: [
            { name: 'TIPO', type: 'esriFieldTypeString', alias: 'TIPO' },
            { name: 'DENOM', type: 'esriFieldTypeString', alias: 'DENOM' },
            { name: 'CATEG', type: 'esriFieldTypeString', alias: 'CATEG' }
          ]
        }]
      }));
    }
    
    if (urlStr.includes('POIO_ZONING/FeatureServer/1/query')) {
      return new Response(JSON.stringify({
        features: [
          { attributes: { TIPO: '4', DENOM: 'Ordenanza Nº4', CATEG: 'Residencial' } }
        ]
      }));
    }

    return new Response(JSON.stringify({}), { status: 404 });
  };
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('ArcGisUniversalZoningAdapter', () => {
  let adapter: ArcGisUniversalZoningAdapter;
  const mockGeometry: ParcelGeometry = {
    type: 'MultiPolygon',
    coordinates: [[[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]]
  };

  beforeEach(() => {
    adapter = new ArcGisUniversalZoningAdapter({
      client: new MockOpenAI()
    });
  });

  it('should resolve TEO correctly using code and ordenanza (single layer URL)', async () => {
    const result = await adapter.resolveZoning({
      parcelGeometry: mockGeometry,
      serviceUrl: 'https://test.com/PXOM_201006_AD_4ORDSUC_00Ordenanzas_VP/FeatureServer/0'
    });

    expect(result.length).toBe(2);
    expect(result[0].code).toBe('U-1');
    expect(result[0].label).toBe('Residencial U-1');
    expect(result[1].code).toBe('U-8');
    
    // No hardcoded municipal checks
    expect(result[0].sourceType).toBe('arcgis_featureserver');
    expect(result[0].semanticDimension).toBe('ordinance');
  });

  it('should resolve POIO correctly using TIPO and DENOM (base URL)', async () => {
    const result = await adapter.resolveZoning({
      parcelGeometry: mockGeometry,
      serviceUrl: 'https://test.com/POIO_ZONING/FeatureServer'
    });

    expect(result.length).toBe(1);
    expect(result[0].code).toBe('4');
    expect(result[0].label).toBe('Ordenanza Nº4');
    expect(result[0].rawAttributes['CATEG']).toBe('Residencial');
  });
});
