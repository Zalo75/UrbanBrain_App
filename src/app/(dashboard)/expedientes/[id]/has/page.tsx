import { redirect } from 'next/navigation'
import { getExpedienteAccess } from '@/application/authorization/expedienteAccess'
import { buildTerritorialContextView } from '@/application/territorial-resolver/territorialContextView'
import { loadAuthorizedParcelInputs } from '@/infrastructure/db/parcelContextRepository'
import { HasSessionView } from './HasSessionView'
import { persistHasAlignment } from './actions'
import { getLatestCompatibleHasAlignment } from '@/infrastructure/db/hasAlignmentRepository'
import { bboxesCompatible } from './bboxCompatibility'
import { CartographicViewEvidence, type HasCartographicInput } from '@/infrastructure/territorial-resolver/cartographicViewEvidence'

function geometryBbox(geometry: any) {
  const rings = geometry?.type === 'MultiPolygon' ? geometry.coordinates.flat(1) : geometry?.coordinates
  if (!Array.isArray(rings) || !rings.length) return null
  const points = rings.flatMap((ring: any) => Array.isArray(ring) ? ring : [])
  const xs = points.map((point: any) => Number(point?.[0])).filter(Number.isFinite)
  const ys = points.map((point: any) => Number(point?.[1])).filter(Number.isFinite)
  if (!xs.length || !ys.length) return null
  const minLng = Math.min(...xs), maxLng = Math.max(...xs), minLat = Math.min(...ys), maxLat = Math.max(...ys)
  const padLng = Math.max((maxLng - minLng) * 0.2, 0.002)
  const padLat = Math.max((maxLat - minLat) * 0.2, 0.002)
  return { minLat: Math.max(-90, minLat - padLat), minLng: Math.max(-180, minLng - padLng), maxLat: Math.min(90, maxLat + padLat), maxLng: Math.min(180, maxLng + padLng) }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const access = await getExpedienteAccess(resolvedParams.id)
  if (!access.ok) return { title: 'HAS - UrbanBrain' }
  return { title: `Ajuste HAS - ${access.expediente.name} - UrbanBrain` }
}

export default async function HasSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const access = await getExpedienteAccess(resolvedParams.id)
  if (!access.ok) {
    redirect('/dashboard')
  }

  const { expediente } = access
  const parcelInputs = await loadAuthorizedParcelInputs(expediente.id, access.userId)
  const territorialContext = buildTerritorialContextView(parcelInputs?.detected)
  const hasEligibility = territorialContext?.ordinanceResolution?.hasEligibility
  const parcelGeometry = territorialContext?.parcelGeometry
  let cartography: { inputs: HasCartographicInput[]; limitations: string[] } = { inputs: [], limitations: [] }
  const municipalityCode = territorialContext?.municipalityCode
  const instrumentId = parcelInputs?.detected?.applicableInstruments?.find((instrument: any) => instrument.status === 'current')?.id
  const bbox = geometryBbox(parcelGeometry)
  if (municipalityCode && instrumentId && bbox) {
    const evidence = new CartographicViewEvidence({
      expedienteId: expediente.id,
      municipalityCode,
      instrumentId,
      planning: { status: 'partial', applicableInstruments: parcelInputs?.detected?.applicableInstruments ?? [], documents: parcelInputs?.detected?.planningDocuments ?? [], evidence: [], warnings: [] },
    })
    cartography = await evidence.acquireHasPair({ operation: 'acquire', representation: 'pair', bbox, width: 508, height: 508 })
  } else {
    cartography.limitations.push('CARTOGRAPHY_INPUT_NOT_AVAILABLE: geometría, municipio o instrumento no acreditados')
  }
  const historical = cartography.inputs.find(input => input.kind === 'historical')
  const modern = cartography.inputs.find(input => input.kind === 'modern')
  const cadastralReference = territorialContext?.cadastralReference
  const storedAlignment = historical && modern && cadastralReference
    ? await getLatestCompatibleHasAlignment({ expedienteId: expediente.id, cadastralReference, historicalViewId: historical.provenance.id, modernViewId: modern.provenance.id, crs: 'EPSG:4326' })
    : null
  const initialAlignment = storedAlignment && (storedAlignment.historicalProvenance as any)?.checksum === historical?.provenance.checksum && (storedAlignment.modernProvenance as any)?.checksum === modern?.provenance.checksum && bboxesCompatible(storedAlignment.bbox, modern?.provenance.bbox) ? storedAlignment : null

  return (
    <HasSessionView
      expedienteId={expediente.id}
      expedienteName={expediente.name}
      hasEligibility={hasEligibility}
      parcelGeometry={parcelGeometry}
      cadastralReference={cadastralReference}
      cartography={cartography}
      initialAlignment={initialAlignment ? { transform: initialAlignment.transform, historicalViewId: initialAlignment.historicalViewId, modernViewId: initialAlignment.modernViewId } : null}
      persistAlignment={persistHasAlignment}
    />
  )
}
