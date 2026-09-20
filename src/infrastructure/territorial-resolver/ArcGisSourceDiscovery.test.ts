import { ArcGisSourceDiscovery } from './ArcGisSourceDiscovery';

// Mock Fetch
const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = async (url: string | Request | URL) => {
    const urlStr = url.toString();
    
    // TEO: Experience Builder Data
    if (urlStr.includes('https://experience.arcgis.com/sharing/rest/content/items/teo-item-123/data?f=json')) {
      return new Response(JSON.stringify({
        dataSources: {
          ds1: {
            id: 'ds1',
            label: 'Ordenanzas',
            url: 'https://test.com/PXOM_201006_AD_4ORDSUC_00Ordenanzas_VP/FeatureServer/0'
          }
        }
      }));
    }

    // POIO: WebMap Data
    if (urlStr.includes('https://concello.maps.arcgis.com/sharing/rest/content/items/poio-item-456/data?f=json')) {
      return new Response(JSON.stringify({
        operationalLayers: [
          {
            id: 'layer1',
            title: 'Zonificacion',
            url: 'https://test.com/POIO_ZONING/FeatureServer'
          }
        ]
      }));
    }

    // DIRECT SERVICE VALIDATION
    if (urlStr.includes('PXOM_201006_AD_4ORDSUC_00Ordenanzas_VP/FeatureServer/0?f=json')) {
      return new Response(JSON.stringify({
        id: 0,
        name: 'Ordenanzas TEO',
        type: 'Feature Layer'
      }));
    }
    
    if (urlStr.includes('POIO_ZONING/FeatureServer?f=json')) {
      return new Response(JSON.stringify({
        layers: [ { id: 1, name: 'Zonificacion' } ]
      }));
    }

    // INVALID SOURCE
    if (urlStr.includes('INVALID/FeatureServer?f=json')) {
      return new Response(JSON.stringify({ error: { code: 400, message: 'Invalid URL' } }));
    }

    return new Response(JSON.stringify({}), { status: 404 });
  };
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('ArcGisSourceDiscovery', () => {
  let discovery: ArcGisSourceDiscovery;

  beforeEach(() => {
    discovery = new ArcGisSourceDiscovery();
  });

  it('TEO_DISCOVERY: should discover FeatureServer from Experience Builder URL', async () => {
    const result = await discovery.discover([
      'https://experience.arcgis.com/experience/?id=teo-item-123'
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://test.com/PXOM_201006_AD_4ORDSUC_00Ordenanzas_VP/FeatureServer/0');
    expect(result[0].sourceType).toBe('featureserver');
    expect(result[0].title).toBe('Ordenanzas');
    expect(result[0].provenance[0]).toContain('Experience Builder item teo-item-123');
  });

  it('POIO_DISCOVERY: should discover FeatureServer from WebMap item URL', async () => {
    const result = await discovery.discover([
      'https://concello.maps.arcgis.com/apps/webappviewer/index.html?id=poio-item-456'
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://test.com/POIO_ZONING/FeatureServer');
    expect(result[0].sourceType).toBe('featureserver');
    expect(result[0].title).toBe('Zonificacion');
    expect(result[0].provenance[0]).toContain('WebMap item poio-item-456');
  });

  it('should validate and discover direct FeatureServer URLs', async () => {
    const result = await discovery.discover([
      'https://test.com/POIO_ZONING/FeatureServer'
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://test.com/POIO_ZONING/FeatureServer');
    expect(result[0].title).toBe('Unnamed ArcGIS Service'); // Mock doesn't return documentInfo
    expect(result[0].provenance[0]).toContain('Directly validated');
  });

  it('INVALID_ARCGIS_SOURCE: should fail safe on invalid direct URLs', async () => {
    const result = await discovery.discover([
      'https://test.com/INVALID/FeatureServer'
    ]);

    expect(result).toHaveLength(0); // Gracefully returns empty
  });

  it('MULTIPLE_CANDIDATES: should deduplicate and handle multiple mixed URLs safely', async () => {
    const result = await discovery.discover([
      'https://experience.arcgis.com/experience/?id=teo-item-123',
      'https://test.com/POIO_ZONING/FeatureServer',
      'https://test.com/POIO_ZONING/FeatureServer', // duplicate
      'https://bad-domain.com/experience/?id=bad-item-999' // 404 item
    ]);

    expect(result).toHaveLength(2);
    const urls = result.map(r => r.url);
    expect(urls).toContain('https://test.com/PXOM_201006_AD_4ORDSUC_00Ordenanzas_VP/FeatureServer/0');
    expect(urls).toContain('https://test.com/POIO_ZONING/FeatureServer');
  });
});
