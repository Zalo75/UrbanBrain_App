import type { ArcGisSourceInfo } from '@/domain/territorial-resolver/types';

export class ArcGisSourceDiscovery {
  /**
   * Discover valid ArcGIS public sources from a list of generic or raw URLs.
   * This is the V1 discovery primitive, which resolves Experience/WebMap items 
   * into their underlying FeatureServer/MapServer URLs and validates them.
   */
  async discover(rawUrls: string[]): Promise<ArcGisSourceInfo[]> {
    const discovered: ArcGisSourceInfo[] = [];

    for (const url of rawUrls) {
      if (!url || typeof url !== 'string') continue;

      try {
        if (url.toLowerCase().includes('featureserver') || url.toLowerCase().includes('mapserver')) {
          // Direct service URL
          const valid = await this.validateDirectService(url);
          if (valid) discovered.push(valid);
        } else if (url.includes('id=')) {
          // Likely an ArcGIS Item (Experience, WebMap, etc)
          const sources = await this.discoverFromItem(url);
          discovered.push(...sources);
        }
      } catch {
        // Fail-safe: ignore bad URLs or network errors and continue
        continue;
      }
    }

    // Deduplicate by URL
    const unique = new Map<string, ArcGisSourceInfo>();
    for (const source of discovered) {
      if (!unique.has(source.url)) {
        unique.set(source.url, source);
      }
    }

    return Array.from(unique.values());
  }

  private async validateDirectService(url: string): Promise<ArcGisSourceInfo | null> {
    // Strip trailing slashes and query params to get base URL
    const baseUrl = url.split('?')[0].replace(/\/$/, '');
    
    const res = await fetch(`${baseUrl}?f=json`, { method: 'GET' });
    if (!res.ok) return null;
    
    const data = await res.json();
    
    if (data.error) return null;
    if (!data.layers && !data.id && data.id !== 0) return null; // Very basic check that it's a valid service/layer metadata

    const isLayer = data.type === 'Feature Layer' || data.type === 'Raster Layer';
    const typeLabel = url.toLowerCase().includes('featureserver') ? 'featureserver' : 'mapserver';

    return {
      url: baseUrl,
      sourceType: typeLabel,
      title: data.documentInfo?.Title || data.name || 'Unnamed ArcGIS Service',
      provenance: [
        `Directly validated ${typeLabel} REST metadata.`,
        isLayer ? 'URL points directly to a specific layer.' : `Service contains ${data.layers?.length || 0} layers.`
      ],
      confidence: 'high'
    };
  }

  private async discoverFromItem(url: string): Promise<ArcGisSourceInfo[]> {
    const parsed = new URL(url);
    const itemId = parsed.searchParams.get('id');
    if (!itemId) return [];

    // Derive the portal API endpoint from the original URL's origin
    const portalApiUrl = `${parsed.origin}/sharing/rest/content/items/${itemId}/data?f=json`;
    
    const res = await fetch(portalApiUrl, { method: 'GET' });
    if (!res.ok) return [];

    const data = await res.json();
    if (data.error) return [];

    const sources: ArcGisSourceInfo[] = [];

    // Case 1: WebMap (has operationalLayers)
    if (Array.isArray(data.operationalLayers)) {
      for (const layer of data.operationalLayers) {
        if (layer.url && (layer.url.includes('FeatureServer') || layer.url.includes('MapServer'))) {
          sources.push({
            url: layer.url,
            sourceType: layer.url.toLowerCase().includes('featureserver') ? 'featureserver' : 'mapserver',
            title: layer.title || layer.id,
            provenance: [
              `Extracted from WebMap item ${itemId} (operational layer: ${layer.title || layer.id})`
            ],
            confidence: 'high'
          });
        }
      }
    }

    // Case 2: Experience Builder (has dataSources)
    if (data.dataSources && typeof data.dataSources === 'object') {
      for (const dsKey of Object.keys(data.dataSources)) {
        const ds = data.dataSources[dsKey];
        if (ds.url && (ds.url.includes('FeatureServer') || ds.url.includes('MapServer'))) {
          sources.push({
            url: ds.url,
            sourceType: ds.url.toLowerCase().includes('featureserver') ? 'featureserver' : 'mapserver',
            title: ds.label || ds.id,
            provenance: [
              `Extracted from Experience Builder item ${itemId} (datasource: ${ds.label || ds.id})`
            ],
            confidence: 'high'
          });
        }
      }
    }

    return sources;
  }
}
