import type {
  AffectApplicability,
  AffectPort,
  ParcelGeometry,
  TerritorialAffect,
  TerritorialCoordinates,
} from '@/domain/territorial-resolver/types'
import { fetchOfficial, type FetchLike } from '@/infrastructure/territorial-resolver/officialHttp'

export interface LayerDefinition {
  id: string
  category: string
  name: string
  url: string
}

export const VERIFIED_AFFECT_LAYERS: LayerDefinition[] = [
  {
    id: 'bic_integral_area',
    category: 'patrimonio_cultural',
    name: 'BIC: área integral',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_PatrimonioCultural/MapServer/4/query',
  },
  {
    id: 'bic_protection_buffer',
    category: 'patrimonio_cultural',
    name: 'BIC: contorno de protección',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_PatrimonioCultural/MapServer/9/query',
  },
  {
    id: 'bic_buffer_area',
    category: 'patrimonio_cultural',
    name: 'BIC: área de amortiguamiento',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_PatrimonioCultural/MapServer/10/query',
  },
  {
    id: 'catalogue_protection_buffer',
    category: 'patrimonio_cultural',
    name: 'Catálogo: contorno de protección',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_PatrimonioCultural/MapServer/12/query',
  },
  {
    id: 'special_protection_plan',
    category: 'patrimonio_cultural',
    name: 'Plan especial de protección',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_PatrimonioCultural/MapServer/13/query',
  },
  {
    id: 'camino_de_santiago_area',
    category: 'patrimonio_cultural',
    name: 'Camino de Santiago: ámbito delimitado',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_PatrimonioCultural/MapServer/15/query',
  },
  {
    id: 'natura_2000_zec',
    category: 'medio_ambiente',
    name: 'Red Natura 2000: ZEC',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_MedioAmbiente_CN/MapServer/7/query',
  },
  {
    id: 'water_channel_police',
    category: 'aguas',
    name: 'Policía de cauces',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_Augas/MapServer/1/query',
  },
  {
    id: 'water_preferential_flow',
    category: 'aguas',
    name: 'Zona de flujo preferente',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_Augas/MapServer/2/query',
  },
  {
    id: 'water_public_domain',
    category: 'aguas',
    name: 'Dominio público hidráulico cartografiado',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_Augas/MapServer/7/query',
  },
  {
    id: 'road_autonomic_domain_cc',
    category: 'transporte',
    name: 'Carretera autonómica: dominio público viario CC',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_Transporte/MapServer/7/query',
  },
  {
    id: 'road_autonomic_domain_vac',
    category: 'transporte',
    name: 'Carretera autonómica: dominio público viario VAC',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_Transporte/MapServer/8/query',
  },
  {
    id: 'road_autonomic_affect_cc',
    category: 'transporte',
    name: 'Carretera autonómica: zona de afección CC',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_Transporte/MapServer/10/query',
  },
  {
    id: 'road_autonomic_affect_vac',
    category: 'transporte',
    name: 'Carretera autonómica: zona de afección VAC',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_Transporte/MapServer/11/query',
  },
  {
    id: 'road_state_provincial_area',
    category: 'transporte',
    name: 'Área de carretera estatal o provincial',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_Transporte/MapServer/16/query',
  },
  {
    id: 'approved_road_project',
    category: 'transporte',
    name: 'Proyecto viario aprobado (AXI)',
    url: 'https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_Transporte/MapServer/5/query',
  },
]

interface ArcGisFeature {
  attributes?: Record<string, unknown>
}

interface ArcGisResponse {
  features?: ArcGisFeature[]
  error?: { message?: string }
}

function geometryParameters(coordinates?: TerritorialCoordinates, geometry?: ParcelGeometry) {
  if (geometry?.coordinates[0]?.[0]) {
    return {
      geometry: JSON.stringify({
        rings: geometry.coordinates.flatMap((polygon) => polygon),
        spatialReference: { wkid: 4326 },
      }),
      geometryType: 'esriGeometryPolygon',
    }
  }
  if (coordinates) {
    return {
      geometry: `${coordinates.lng},${coordinates.lat}`,
      geometryType: 'esriGeometryPoint',
    }
  }
  return null
}

function safeAttributes(attributes: Record<string, unknown> | undefined) {
  if (!attributes) return {}
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
      .slice(0, 12)
  )
}

export class IdegAffectAdapter implements AffectPort {
  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 8_000,
    private readonly now: () => Date = () => new Date(),
    private readonly layers: LayerDefinition[] = VERIFIED_AFFECT_LAYERS
  ) {}

  async findAffects(location: {
    coordinates?: TerritorialCoordinates
    geometry?: ParcelGeometry
  }): Promise<AffectApplicability> {
    const spatial = geometryParameters(location.coordinates, location.geometry)
    if (!spatial) {
      return {
        analysisGeometry: 'none',
        detected: [],
        canRuleOutUndetectedAffects: false,
        warnings: [
          {
            code: 'affects_location_missing',
            message: 'No existe geometría ni punto para consultar afecciones.',
          },
        ],
      }
    }

    const states = await Promise.allSettled(
      this.layers.map(async (layer) => {
        const url = new URL(layer.url)
        const body = new URLSearchParams({
          f: 'json',
          where: '1=1',
          geometry: spatial.geometry,
          geometryType: spatial.geometryType,
          inSR: '4326',
          spatialRel: 'esriSpatialRelIntersects',
          outFields: '*',
          returnGeometry: 'false',
        })
        const response = await fetchOfficial(this.fetcher, 'IDEG', url, this.timeoutMs, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body,
        })
        const payload = (await response.json()) as ArcGisResponse
        if (payload.error) throw new Error(payload.error.message || 'IDEG query error')
        return { layer, url, features: payload.features ?? [] }
      })
    )

    const retrievedAt = this.now().toISOString()
    const detected: TerritorialAffect[] = states.flatMap((state) => {
      if (state.status === 'rejected') return []
      return state.value.features.map((feature, index) => ({
        category: state.value.layer.category,
        name: state.value.layer.name,
        featureId: `${state.value.layer.id}:${String(
          feature.attributes?.OBJECTID ?? feature.attributes?.objectid ?? index
        )}`,
        attributes: safeAttributes(feature.attributes),
        evidence: {
          source: 'ideg' as const,
          sourceUrl: state.value.url.toString(),
          retrievedAt,
          method: 'ArcGIS REST spatial intersects',
        },
        confidence: 'high' as const,
      }))
    })
    const failures = states.filter((state) => state.status === 'rejected').length

    return {
      analysisGeometry: location.geometry ? 'parcel' : 'point',
      detected,
      canRuleOutUndetectedAffects: false,
      warnings: [
        {
          code: 'partial_affect_coverage',
          message:
            'La consulta automática cubre capas verificadas de patrimonio cultural, Red Natura 2000 ZEC, aguas y transporte; no descarta otras afecciones ni sustituye informes sectoriales.',
        },
        ...(location.geometry
          ? []
          : [
              {
                code: 'point_only_affect_analysis',
                message:
                  'El análisis usa un punto y no permite descartar afecciones sobre el resto de la parcela.',
              },
            ]),
        ...(failures
          ? [
              {
                code: 'affect_sources_unavailable',
                message: `${failures} capas oficiales no respondieron; el resultado es incompleto.`,
              },
            ]
          : []),
      ],
    }
  }
}
