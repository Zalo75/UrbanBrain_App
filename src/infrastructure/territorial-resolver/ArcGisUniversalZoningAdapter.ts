import type { ParcelGeometry, UrbanisticIdentitySemanticType, ZoningIdentity } from '@/domain/territorial-resolver/types';

export interface ArcGisLayerMetadata {
  id: number;
  name: string;
  type?: string;
  geometryType?: string;
  fields?: Array<{ name: string; type: string; alias: string }>;
  description?: string;
}

export interface MinimalLLMClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        response_format?: { type: 'json_object' };
      }): Promise<{
        choices: Array<{ message: { content: string | null } }>;
      }>;
    };
  };
}

interface ArcGisFeature {
  attributes?: Record<string, unknown>;
}

function semanticDimension(value: unknown): UrbanisticIdentitySemanticType | undefined {
  const allowed: UrbanisticIdentitySemanticType[] = ['classification', 'category', 'qualification', 'zoning', 'ordinance', 'degree', 'area', 'affect', 'protection', 'unknown']
  return typeof value === 'string' && allowed.includes(value as UrbanisticIdentitySemanticType)
    ? value as UrbanisticIdentitySemanticType
    : undefined
}

export class ArcGisUniversalZoningAdapter {
  private readonly llm?: MinimalLLMClient;

  constructor(options: { client?: MinimalLLMClient } = {}) {
    this.llm = options.client;
  }

  async resolveZoning(input: {
    parcelGeometry: ParcelGeometry;
    serviceUrl: string;
  }): Promise<ZoningIdentity[]> {
    try {
      // The production wiring does not inject a budget-controlled client here.
      // Fail closed instead of creating a provider-specific OpenAI client.
      if (!this.llm) return [];

      // 1. Discover Layers
      const layers = await this.discoverLayers(input.serviceUrl);
      if (layers.length === 0) {
        return this.fallback('unsupported', 'No layers found at the provided ArcGIS service URL.', input.serviceUrl);
      }

      // 2. Semantic Layer Selection via LLM
      const selection = await this.selectZoningLayer(layers);
      if (selection.isDetailedZoning !== 'YES' || selection.layerId === null) {
        return this.fallback('unresolved', 'No detailed zoning layer (ordenanza) identified by semantic analysis.', input.serviceUrl);
      }

      const layerUrl = this.getLayerUrl(input.serviceUrl, selection.layerId);

      // 3. Spatial Query
      const queryResult = await this.querySpatialIntersection(layerUrl, input.parcelGeometry);
      if (!queryResult.features || queryResult.features.length === 0) {
        return this.fallback('unresolved', 'Spatial query returned no intersecting zoning polygons.', input.serviceUrl);
      }

      // 4. Normalize Output
      const identities: ZoningIdentity[] = queryResult.features.map((feature: ArcGisFeature) => {
        const attrs = feature.attributes || {};
        
        // Use LLM-suggested fields to extract code and label
        let code: string | null = null;
        let label: string | null = null;

        for (const field of selection.identityFields) {
          if (attrs[field] !== undefined && attrs[field] !== null && !code) {
            code = String(attrs[field]);
          }
        }
        for (const field of selection.labelFields) {
          if (attrs[field] !== undefined && attrs[field] !== null && !label) {
            label = String(attrs[field]);
          }
        }
        
        // If code is still null, just fallback to the first non-OID string field
        if (!code) {
          const firstStringField = Object.keys(attrs).find(k => typeof attrs[k] === 'string' && !k.toLowerCase().includes('objectid'));
          if (firstStringField) code = String(attrs[firstStringField]);
        }

        return {
          code,
          label,
          sourceType: 'arcgis_featureserver',
          sourceUrl: input.serviceUrl,
          layerId: selection.layerId,
          rawAttributes: attrs,
          confidence: 'high',
          semanticDimension: semanticDimension(selection.semanticDimension),
          evidence: [
            `Layer '${selection.layerName}' selected via LLM semantic analysis.`,
            `Spatial intersection with parcel geometry returned ${queryResult.features.length} zones.`,
            `Code extracted via semantic fields: ${selection.identityFields.join(', ')}`
          ]
        } satisfies ZoningIdentity;
      });

      return identities;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return this.fallback('unresolved', `ArcGIS execution error: ${message}`, input.serviceUrl);
    }
  }

  private fallback(status: string, message: string, url: string): ZoningIdentity[] {
    return [{
      code: null,
      label: null,
      sourceType: 'arcgis_featureserver',
      sourceUrl: url,
      layerId: null,
      rawAttributes: { _status: status, _error: message },
      confidence: 'low',
      evidence: [message]
    }];
  }

  private async discoverLayers(serviceUrl: string): Promise<ArcGisLayerMetadata[]> {
    const isSingleLayer = /\/\d+$/.test(serviceUrl);
    
    if (isSingleLayer) {
      const res = await fetch(`${serviceUrl}?f=json`);
      if (!res.ok) return [];
      const data = await res.json();
      return [{
        id: Number(data.id),
        name: String(data.name),
        type: data.type ? String(data.type) : undefined,
        geometryType: data.geometryType ? String(data.geometryType) : undefined,
        fields: data.fields,
        description: data.description ? String(data.description) : undefined
      }];
    } else {
      const res = await fetch(`${serviceUrl}/layers?f=json`);
      if (!res.ok) return [];
      const data = await res.json();
      const rawLayers = Array.isArray(data.layers) ? data.layers : [];
      return rawLayers.map((l: Record<string, unknown>) => ({
        id: Number(l.id),
        name: String(l.name),
        type: l.type ? String(l.type) : undefined,
        geometryType: l.geometryType ? String(l.geometryType) : undefined,
        fields: Array.isArray(l.fields) ? l.fields : undefined,
        description: l.description ? String(l.description) : undefined
      }));
    }
  }

  private getLayerUrl(baseUrl: string, layerId: number): string {
    if (/\/\d+$/.test(baseUrl)) {
      return baseUrl; // It's already a layer URL
    }
    return `${baseUrl}/${layerId}`;
  }

  private async selectZoningLayer(layers: ArcGisLayerMetadata[]): Promise<{
    isDetailedZoning: 'YES' | 'NO' | 'UNCERTAIN';
    layerId: number | null;
    layerName: string | null;
    identityFields: string[];
    labelFields: string[];
    rationale: string;
    semanticDimension?: UrbanisticIdentitySemanticType;
  }> {
    const llm = this.llm;
    if (!llm) throw new Error('ArcGIS zoning LLM client is not configured');

    const payload = layers.map(l => ({
      id: l.id,
      name: l.name,
      geometryType: l.geometryType,
      fields: (l.fields || []).map(f => ({ name: f.name, alias: f.alias, type: f.type }))
    }));

    const response = await llm.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an expert GIS and urban planning system. 
You will be provided with metadata for several ArcGIS layers.
Your job is to identify if there is a detailed zoning layer (ordenanza, calificación pormenorizada, normativa específica). 
Do NOT confuse general land classification (suelo urbano/rústico) with detailed zoning (Ordenanza 1, U-8, PERI, etc).
Return a JSON object with this exact schema:
{
  "IS_DETAILED_ZONING_LAYER": "YES" | "NO" | "UNCERTAIN",
  "LAYER_ID": number | null,
  "LAYER_NAME": string | null,
  "IDENTITY_FIELDS": string[], // fields that probably hold the zoning code (e.g. 'cod', 'TIPO', 'clave')
  "LABEL_FIELDS": string[], // fields that probably hold the human-readable zoning name (e.g. 'ordenanza', 'DENOM')
  "PARAMETER_FIELDS": string[], // other interesting fields like usage, height
  "RATIONALE": string
  "SEMANTIC_DIMENSION": "classification" | "category" | "qualification" | "zoning" | "ordinance" | "degree" | "area" | "affect" | "protection" | "unknown"
}
Only choose Polygon geometry layers. Classify the identity dimension represented by the selected layer; do not infer an ordinance merely because a layer is polygonal.`
        },
        {
          role: 'user',
          content: JSON.stringify(payload, null, 2)
        }
      ],
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error('Empty LLM response');
    
    const parsed = JSON.parse(content);
    return {
      isDetailedZoning: parsed.IS_DETAILED_ZONING_LAYER,
      layerId: parsed.LAYER_ID,
      layerName: parsed.LAYER_NAME,
      identityFields: Array.isArray(parsed.IDENTITY_FIELDS) ? parsed.IDENTITY_FIELDS : [],
      labelFields: Array.isArray(parsed.LABEL_FIELDS) ? parsed.LABEL_FIELDS : [],
      rationale: parsed.RATIONALE || '',
      semanticDimension: semanticDimension(parsed.SEMANTIC_DIMENSION),
    };
  }

  private async querySpatialIntersection(layerUrl: string, parcelGeometry: ParcelGeometry): Promise<{ features: ArcGisFeature[] }> {
    // Domain ParcelGeometry is strictly MultiPolygon, so we can directly map outer rings
    // Convert GeoJSON to Esri Geometry. GeoJSON MultiPolygon coordinates are Polygon[] (where Polygon = Ring[]).
    // Esri rings is just an array of rings. So we flatten MultiPolygon coordinates by 1 level.
    const esriRings = parcelGeometry.type === 'MultiPolygon' 
      ? (parcelGeometry.coordinates as unknown as number[][][][]).flat(1)
      : (parcelGeometry.coordinates as unknown as number[][][]);

    const params = new URLSearchParams({
      f: 'json',
      geometry: JSON.stringify({ rings: esriRings, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryPolygon',
      spatialRel: 'esriSpatialRelIntersects',
      inSR: '4326',
      outSR: '4326',
      outFields: '*',
      returnGeometry: 'false'
    });

    const res = await fetch(`${layerUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!res.ok) {
      throw new Error(`Spatial query failed with status ${res.status}`);
    }

    return await res.json();
  }
}
