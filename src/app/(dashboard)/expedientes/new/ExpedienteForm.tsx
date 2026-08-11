'use client'

import Link from 'next/link'
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, CircleDashed, ExternalLink, Loader2, Sparkles, TriangleAlert, Wand2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ActiveZoneContext } from '@/components/territorial/ActiveZoneContext'
import { AvailableZonesSummary } from '@/components/territorial/AvailableZonesSummary'
import { GeometricAuditAccordion } from '@/components/territorial/GeometricAuditAccordion'
import { MapcentricWorkspace } from '@/components/territorial/MapcentricWorkspace'
import { ParcelMap } from '@/components/maps/ParcelMap'
import { clearAutomaticClassificationCandidate } from '@/application/territorial-resolver/actionAreaSelection'
import type { Municipality, Province } from '@/shared/territory'
import type { ClassificationCandidate } from '@/domain/territorial-resolver/types'

import {
  createExpediente,
  detectContextAction,
  getPlanningOptionsAction,
} from './actions'
import { initialCreateExpedienteState, type CreateExpedienteState } from './creationState'
import {
  LAND_CLASS_OPTIONS,
  landClassFromCandidate,
  planningZoneNameFromCandidate,
  municipalitiesForProvince,
  type DetectionProgressItem,
  type SmartCaseDetection,
} from './smartCaseDetection'

function ProgressIcon({ status }: { status: DetectionProgressItem['status'] }) {
  if (status === 'calculating') return <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="Calculando" />
  if (status === 'success') return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Correcto" />
  if (status === 'incomplete') return <TriangleAlert className="h-4 w-4 text-amber-600" aria-label="Comprobación incompleta" />
  return <CircleDashed className="h-4 w-4 text-muted-foreground" aria-label="No determinado" />
}

function sourceLabel(source: string) {
  return source === 'ideg' ? 'Cartografía oficial de Galicia (IDEG)' : source
}

function confidenceLabel(confidence: 'high' | 'medium' | 'low') {
  return {
    high: 'Confianza alta',
    medium: 'Confianza media',
    low: 'Confianza baja',
  }[confidence]
}

type TerritorialInputSource = 'cadastral_reference' | 'coordinates' | 'address'

function traceTerritorialDetection(event: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'development') {
    console.debug('[territorial-detection]', { event, ...details })
  }
}

function ProgressPanel({
  detection,
  calculating,
  detectionInvalidated,
}: {
  detection: SmartCaseDetection | null
  calculating: boolean
  detectionInvalidated: boolean
}) {
  const items = calculating
    ? [
        'Referencia catastral validada', 'Parcela localizada', 'Dirección obtenida', 'Provincia identificada',
        'Municipio identificado', 'Código INE obtenido', 'Coordenadas obtenidas', 'Planeamiento consultado',
        'Clasificación consultada', 'Afecciones consultadas',
      ].map((label, index) => ({ id: String(index), label, status: 'calculating' as const, detail: 'Consultando fuentes oficiales' }))
    : detection?.progress ?? []

  if (!items.length && !detectionInvalidated) return null
  const affectsIncomplete = detection?.sourceChecks.some(
    (check) => check.source === 'ideg' && ['partial', 'timeout', 'unavailable', 'malformed'].includes(check.status)
  )
  return (
    <section aria-live="polite" className="rounded-lg border bg-muted/30 p-4">
      <h2 className="text-base font-semibold">Progreso de la detección</h2>
      <p className="mt-1 text-sm text-muted-foreground">Cada estado se basa en el resultado disponible de las fuentes oficiales consultadas.</p>
      {detectionInvalidated && (
        <p role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          Los datos de localización han cambiado. El contexto territorial anterior ya no se utilizará. Actualice el análisis antes de crear el expediente.
        </p>
      )}
      {!!items.length && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className="flex gap-2 text-sm">
              <span className="mt-0.5"><ProgressIcon status={item.status} /></span>
              <span>
                <span className="block font-medium">{item.label}</span>
                <span className="block text-muted-foreground">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {detection && (
        <div className="mt-4 border-t pt-4 text-sm">
          <p className="font-medium">Afecciones y cobertura</p>
          {detection.affects.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {detection.affects.map((affect) => (
                <li key={`${affect.category}-${affect.featureId ?? affect.name}`}>
                  {affect.name} · {confidenceLabel(affect.confidence)} · {sourceLabel(affect.evidence.source)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted-foreground">
              {affectsIncomplete
                ? 'La comprobación de afecciones no está completa; no equivale a ausencia de afecciones.'
                : 'No se han detectado afecciones positivas.'}
            </p>
          )}
          {detection.sourceChecks
            .filter((check) => ['partial', 'timeout', 'unavailable', 'malformed'].includes(check.status))
            .map((check) => (
              <p key={`${check.source}-${check.status}`} className="mt-2 text-amber-700 dark:text-amber-400">
                {sourceLabel(check.source)}: la fuente no completó la consulta. Puede reintentar o continuar; este dato deberá comprobarse posteriormente.
              </p>
            ))}
        </div>
      )}
    </section>
  )
}

export function ExpedienteForm({ provinces, municipalities }: { provinces: Province[]; municipalities: Municipality[] }) {
  const [name, setName] = useState('')
  const [selectedProvince, setSelectedProvince] = useState('a_coruna')
  const [provinceSelectionOrigin, setProvinceSelectionOrigin] = useState<'fallback' | 'manual' | 'derived'>('fallback')
  const [selectedMunicipality, setSelectedMunicipality] = useState('')
  const [refCatastral, setRefCatastral] = useState('')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [planeamiento, setPlaneamiento] = useState('')
  const [landClass, setLandClass] = useState('')
  const [urbanPlanningZone, setUrbanPlanningZone] = useState('')
  const [selectedClassificationCandidateId, setSelectedClassificationCandidateId] = useState('')
  const [exploredCandidateId, setExploredCandidateId] = useState('')
  const [classificationSelectionReason, setClassificationSelectionReason] = useState('')
  const [classificationManuallyOverridden, setClassificationManuallyOverridden] = useState(false)
  const [actionType, setActionType] = useState('')
  const [notes, setNotes] = useState('')
  const [contextNoticeAccepted, setContextNoticeAccepted] = useState(false)
  const [planningOptionsByMunicipality, setPlanningOptionsByMunicipality] = useState<Record<string, string[]>>({})
  const [detection, setDetection] = useState<SmartCaseDetection | null>(null)
  const [detectionId, setDetectionId] = useState('')
  const [detectionInvalidated, setDetectionInvalidated] = useState(false)
  const [isDetecting, setIsDetecting] = useState(false)
  const [territorialInputSource, setTerritorialInputSource] = useState<TerritorialInputSource | null>(null)
  const submitLock = useRef(false)
  const territorialRevision = useRef(0)
  const latestDetectionRequest = useRef(0)
  const guardedCreateExpediente = useCallback(async (
    previousState: CreateExpedienteState,
    formData: FormData
  ) => {
    if (detectionInvalidated || submitLock.current) return previousState
    submitLock.current = true
    return createExpediente(previousState, formData)
  }, [detectionInvalidated])
  const [createState, createAction, isCreating] = useActionState(guardedCreateExpediente, initialCreateExpedienteState)

  const availableMunicipalities = useMemo(
    () => municipalitiesForProvince(municipalities, selectedProvince),
    [municipalities, selectedProvince]
  )
  const selectedMunicipalityData = municipalities.find((municipality) => municipality.id === selectedMunicipality)
  const planningOptions = planningOptionsByMunicipality[selectedMunicipality] ?? []
  const automaticClassificationCandidate = clearAutomaticClassificationCandidate(
    detection?.classificationResolution
  )
  const detectedMapCoordinates = useMemo(() => {
    if (
      detectionInvalidated ||
      detection?.detected.lat === undefined ||
      detection.detected.lng === undefined
    ) {
      return undefined
    }
    return { lat: detection.detected.lat, lng: detection.detected.lng }
  }, [detection, detectionInvalidated])

  useEffect(() => {
    let active = true
    if (!selectedMunicipality) return () => { active = false }
    getPlanningOptionsAction(selectedMunicipality)
      .then((options) => {
        if (active) setPlanningOptionsByMunicipality((current) => ({ ...current, [selectedMunicipality]: options }))
      })
      .catch(() => {
        if (active) setPlanningOptionsByMunicipality((current) => ({ ...current, [selectedMunicipality]: [] }))
      })
    return () => { active = false }
  }, [selectedMunicipality])

  useEffect(() => {
    if (!isCreating) submitLock.current = false
  }, [isCreating])

  useEffect(() => () => {
    traceTerritorialDetection('form_unmounted', {
      requestId: latestDetectionRequest.current,
      revision: territorialRevision.current,
    })
  }, [])

  function invalidateDetection(reason: string) {
    territorialRevision.current += 1
    const hadDetection = Boolean(detection || detectionId)
    traceTerritorialDetection('context_invalidated', {
      reason,
      requestId: latestDetectionRequest.current,
      revision: territorialRevision.current,
      source: territorialInputSource,
      hadDetection,
    })
    if (hadDetection) {
      setDetectionInvalidated(true)
      setSelectedMunicipality('')
      if (provinceSelectionOrigin === 'derived') {
        setSelectedProvince('')
        setProvinceSelectionOrigin('fallback')
      }
    }
    setPlaneamiento('')
    setLandClass('')
    setUrbanPlanningZone('')
    setSelectedClassificationCandidateId('')
    setExploredCandidateId('')
    setClassificationSelectionReason('')
    setClassificationManuallyOverridden(false)
    setDetection(null)
    setDetectionId('')
  }

  function changeLocationInput(source: TerritorialInputSource, value: string, coordinate?: 'lat' | 'lng') {
    invalidateDetection(source)
    setTerritorialInputSource(source)
    if (source !== 'cadastral_reference') setRefCatastral('')
    if (source !== 'address') setAddress('')
    if (source !== 'coordinates') {
      setLat('')
      setLng('')
    }
    if (source === 'cadastral_reference') setRefCatastral(value)
    if (source === 'address') setAddress(value)
    if (source === 'coordinates' && coordinate === 'lat') setLat(value)
    if (source === 'coordinates' && coordinate === 'lng') setLng(value)
  }

  async function handleDetectContext() {
    const normalizedReference = refCatastral.replace(/[^a-z0-9]/gi, '')
    const hasReference = [14, 18, 20].includes(normalizedReference.length)
    const parsedLat = Number(lat)
    const parsedLng = Number(lng)
    const hasCoordinates = lat.trim() !== '' && lng.trim() !== '' &&
      Number.isFinite(parsedLat) && Number.isFinite(parsedLng)
    const hasAddress = address.trim() !== ''
    const source = territorialInputSource ?? (
      hasReference ? 'cadastral_reference' : hasCoordinates ? 'coordinates' : hasAddress ? 'address' : null
    )
    const hasSelectedInput =
      (source === 'cadastral_reference' && hasReference) ||
      (source === 'coordinates' && hasCoordinates) ||
      (source === 'address' && hasAddress)
    if (!source || !hasSelectedInput) {
      toast.error('Introduzca una referencia catastral válida, las dos coordenadas o una dirección para analizar la parcela.')
      return
    }

    const requestId = latestDetectionRequest.current + 1
    latestDetectionRequest.current = requestId
    const requestRevision = territorialRevision.current
    traceTerritorialDetection('detection_started', {
      requestId,
      revision: requestRevision,
      source,
      cadastralReference: source === 'cadastral_reference' ? refCatastral : undefined,
      coordinates: source === 'coordinates' ? { lat, lng } : undefined,
    })
    setIsDetecting(true)
    try {
      const formData = new FormData()
      formData.append('territorialInputSource', source)
      if (source === 'cadastral_reference') formData.append('refCatastral', refCatastral)
      if (source === 'coordinates') {
        formData.append('lat', lat)
        formData.append('lng', lng)
      }
      if (source === 'address') formData.append('address', address)
      const result = await detectContextAction(formData)
      if ('error' in result) {
        if (requestId !== latestDetectionRequest.current || requestRevision !== territorialRevision.current) return
        toast.error(result.error)
        return
      }

      if (requestId !== latestDetectionRequest.current || requestRevision !== territorialRevision.current) return

      const values = result.detection.detected
      traceTerritorialDetection('detection_received', {
        requestId,
        source,
        cadastralReference: values.cadastralReference,
        coordinates: values.lat !== undefined && values.lng !== undefined ? { lat: values.lat, lng: values.lng } : undefined,
        municipality: values.municipalityCode,
        planningDocument: values.planeamiento,
      })
      setDetection(result.detection)
      setDetectionId(result.detectionId)
      setDetectionInvalidated(false)
      setTerritorialInputSource(values.locationSource ?? source)
      if (values.cadastralReference) setRefCatastral(values.cadastralReference)
      if (values.provinceId && (provinceSelectionOrigin !== 'manual' || selectedProvince !== values.provinceId)) {
        setSelectedProvince(values.provinceId)
        setProvinceSelectionOrigin('derived')
      }
      if (values.municipalityId) setSelectedMunicipality(values.municipalityId)
      if (values.address) setAddress(values.address)
      if (values.lat !== undefined) setLat(String(values.lat))
      if (values.lng !== undefined) setLng(String(values.lng))
      setPlaneamiento(values.planeamiento ?? '')
      const classificationResolution = result.detection.classificationResolution
      const suggestedCandidateId =
        classificationResolution?.automaticSelection?.candidateId ??
        classificationResolution?.proposal?.candidateId
      const suggestedCandidate = classificationResolution?.candidates.find(
        (candidate) => candidate.id === suggestedCandidateId
      )
      setLandClass(values.landClass ?? landClassFromCandidate(suggestedCandidate) ?? '')
      setUrbanPlanningZone(
        values.urbanPlanningZone ?? planningZoneNameFromCandidate(suggestedCandidate)
      )
      // En el rediseño, no autoseleccionamos ninguna zona al arrancar, forzamos selección explícita
      setSelectedClassificationCandidateId('')
      setExploredCandidateId('')
      setClassificationSelectionReason('')
      toast.success('Análisis territorial completado. Revise los datos antes de crear el expediente.')
    } catch {
      if (requestId !== latestDetectionRequest.current || requestRevision !== territorialRevision.current) return
      toast.error('No se ha podido completar el análisis territorial. Puede reintentar o continuar con los datos pendientes.')
    } finally {
      if (requestId === latestDetectionRequest.current) setIsDetecting(false)
    }
  }

  function exploreClassificationCandidate(candidateId: string) {
    setExploredCandidateId(candidateId)
    if (classificationManuallyOverridden) return
    const candidate = detection?.classificationResolution?.candidates.find(
      (item) => item.id === candidateId
    )
    if (!candidate) return
    setLandClass(landClassFromCandidate(candidate) ?? '')
    setUrbanPlanningZone(planningZoneNameFromCandidate(candidate))
  }

  function selectClassificationCandidate(candidate: ClassificationCandidate) {
    const candidateLandClass = landClassFromCandidate(candidate)
    setSelectedClassificationCandidateId(candidate.id)
    setExploredCandidateId(candidate.id)
    setLandClass(candidateLandClass ?? '')
    setUrbanPlanningZone(planningZoneNameFromCandidate(candidate))
    setClassificationSelectionReason('')
    setClassificationManuallyOverridden(
      automaticClassificationCandidate?.id !== candidate.id
    )
    if (!candidateLandClass) {
      toast.info(
        'El código oficial se conserva como evidencia, pero no tiene una equivalencia automática segura. Seleccione manualmente el valor operativo.'
      )
    }
  }

  function resetToAutoClassification() {
    if (
      !exploredCandidateId ||
      automaticClassificationCandidate?.id !== exploredCandidateId
    ) return
    setClassificationManuallyOverridden(false)
    setSelectedClassificationCandidateId(automaticClassificationCandidate.id)
    setLandClass(landClassFromCandidate(automaticClassificationCandidate) ?? '')
    setUrbanPlanningZone(planningZoneNameFromCandidate(automaticClassificationCandidate))
  }

  return (
    <form action={createAction} className="space-y-8" aria-busy={isCreating}>
      <input type="hidden" name="preflightDetectionId" value={detectionId} />
      <input type="hidden" name="territorialDetectionInvalidated" value={detectionInvalidated ? 'true' : ''} />
      <input type="hidden" name="territorialInputSource" value={territorialInputSource ?? ''} />
      <input type="hidden" name="classificationCandidateId" value={selectedClassificationCandidateId} />
      <input type="hidden" name="actionAreaMode" value={selectedClassificationCandidateId ? 'detected_zone' : 'whole_parcel'} />

      {createState.status === 'error' && (
        <div id="creation-error" role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-semibold">Revise el formulario antes de crear el expediente</p>
          <p className="mt-1">{createState.message}</p>
        </div>
      )}

      <section className="space-y-6">
        <h2 className="border-b pb-2 text-xl font-semibold">A. Identificación</h2>
        <div className="grid gap-3">
          <Label htmlFor="name" className="text-base font-medium">Nombre del proyecto <span className="text-destructive">*</span></Label>
          <Input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej.: Reforma de vivienda unifamiliar" required aria-invalid={createState.field === 'name'} aria-describedby={createState.field === 'name' ? 'creation-error' : undefined} className={`h-12 text-base shadow-sm ${createState.field === 'name' ? 'border-destructive' : ''}`} autoFocus />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="grid gap-3">
            <Label htmlFor="province" className="text-base font-medium">Provincia <span className="text-destructive">*</span></Label>
            <select
              id="province" name="province" required value={selectedProvince}
               onChange={(event) => {
                 const provinceId = event.target.value
                 invalidateDetection('province')
                 setSelectedProvince(provinceId)
                 setProvinceSelectionOrigin('manual')
                 if (selectedMunicipalityData?.provinceId !== provinceId) setSelectedMunicipality('')
               }}
              aria-invalid={createState.field === 'province'} aria-describedby={createState.field === 'province' ? 'creation-error' : undefined}
              className={`flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm ${createState.field === 'province' ? 'border-destructive' : ''}`}
            >
              <option value="" disabled>Seleccione una provincia</option>
              {provinces.map((province) => <option key={province.id} value={province.id} disabled={!province.enabled}>{province.name}</option>)}
            </select>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="municipio" className="text-base font-medium">Municipio <span className="text-destructive">*</span></Label>
            <select
              id="municipio" name="municipio" required value={selectedMunicipality}
               onChange={(event) => { invalidateDetection('municipality'); setSelectedMunicipality(event.target.value) }}
              aria-invalid={createState.field === 'municipio'} aria-describedby={createState.field === 'municipio' ? 'creation-error' : undefined}
              className={`flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm ${createState.field === 'municipio' ? 'border-destructive' : ''}`}
            >
              <option value="" disabled>Seleccione un municipio</option>
              {availableMunicipalities.map((municipality) => (
                <option key={municipality.id} value={municipality.id} disabled={!municipality.enabled}>{municipality.name}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Seleccione el municipio para mantener el contexto territorial coherente.</p>
          </div>
        </div>
        <div className="grid gap-3">
          <Label htmlFor="ineCode" className="text-base font-medium">Código INE</Label>
          <Input id="ineCode" value={selectedMunicipalityData?.ineCode ?? ''} readOnly placeholder="Se completa al seleccionar municipio" className="h-12 bg-muted/40 text-base shadow-sm" />
        </div>
      </section>

      <section className="space-y-6 pt-4">
        <h2 className="border-b pb-2 text-xl font-semibold">B. Localización y detección</h2>
        <div className="grid gap-3">
          <Label htmlFor="refCatastral" className="text-base font-medium">Referencia catastral</Label>
          <div className="flex gap-2">
            <Input
              id="refCatastral" name="refCatastral" value={refCatastral}
               onChange={(event) => changeLocationInput('cadastral_reference', event.target.value)}
              placeholder="14 o 20 caracteres" aria-invalid={createState.field === 'refCatastral'} aria-describedby={createState.field === 'refCatastral' ? 'creation-error' : undefined} className={`h-12 flex-1 font-mono text-base shadow-sm ${createState.field === 'refCatastral' ? 'border-destructive' : ''}`}
            />
            <Button type="button" variant="secondary" className="h-12 px-4" onClick={handleDetectContext} disabled={isDetecting}>
              {isDetecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-amber-500" />}
              <span className="ml-2 hidden sm:inline">{detectionInvalidated ? 'Actualizar análisis' : 'Analizar parcela'}</span>
            </Button>
          </div>
          {detection?.detected.parcelReference && <p className="text-sm text-muted-foreground">Referencia parcelaria: <span className="font-mono">{detection.detected.parcelReference}</span></p>}
        </div>
        <ProgressPanel detection={detection} calculating={isDetecting} detectionInvalidated={detectionInvalidated} />
        {detection?.classificationResolution && !detectionInvalidated && (
          <MapcentricWorkspace
            mapSlot={
              <ParcelMap
                geometry={detectionInvalidated ? undefined : detection.detected.parcelGeometry}
                coordinates={detectedMapCoordinates}
                candidates={detectionInvalidated ? undefined : detection.classificationResolution.candidates}
                selectedCandidateId={exploredCandidateId || undefined}
                onCandidateSelect={exploreClassificationCandidate}
              />
            }
            activeZoneSlot={
              <div className="flex flex-col gap-4">
                {selectedClassificationCandidateId ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:bg-emerald-950/20">
                    <div className="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-400 mb-2">
                      <CheckCircle2 className="h-5 w-5" />
                      Zona de trabajo confirmada
                    </div>
                    <p className="text-sm text-emerald-800 dark:text-emerald-300">
                      Esta zona será utilizada como ámbito territorial del expediente.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setSelectedClassificationCandidateId('')}>
                        Volver a parcela completa
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-sky-200 bg-sky-50 p-4 dark:bg-sky-950/20">
                    <h3 className="font-semibold text-sky-900 dark:text-sky-400">Parcela completa (Estado inicial)</h3>
                    <p className="mt-1 text-sm text-sky-800 dark:text-sky-300">
                      {detection.classificationResolution.candidates.length > 1
                        ? 'Se han detectado varias zonas. Selecciona la zona sobre la que deseas trabajar haciendo clic en el mapa.'
                        : 'No se ha fijado una zona de trabajo específica. Puede trabajar con la parcela completa o seleccionar una zona en el mapa.'}
                    </p>
                  </div>
                )}

                {exploredCandidateId && (() => {
                  const candidate = detection.classificationResolution!.candidates.find(c => c.id === exploredCandidateId)
                  if (!candidate) return null
                  return (
                    <div className="flex flex-col gap-3">
                      <ActiveZoneContext candidate={candidate} />
                      {selectedClassificationCandidateId !== exploredCandidateId && (
                        <div className="flex justify-end border-t pt-3">
                          <Button type="button" onClick={() => selectClassificationCandidate(candidate)}>
                            Fijar como Zona de Trabajo
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            }
            availableZonesSlot={
              <AvailableZonesSummary
                candidates={detection.classificationResolution.candidates.filter(c => c.id !== exploredCandidateId)}
                onSelect={exploreClassificationCandidate}
              />
            }
            auditSlot={
              <GeometricAuditAccordion
                totalParcelArea={
                  /* parcelAreaSquareMetres: total catastral parcel area from the first candidate's
                     parcelCoverage. SmartCaseDetection has no standalone surface field; this is
                     the closest typed value available without altering the domain model. Falls back to 0. */
                  detection.classificationResolution.candidates
                    .find((c) => c.parcelCoverage?.parcelAreaSquareMetres !== undefined)
                    ?.parcelCoverage?.parcelAreaSquareMetres ?? 0
                }
                candidates={detection.classificationResolution.candidates}
              />
            }
          />
        )}
        {!detection?.classificationResolution && (
          <ParcelMap
            geometry={detection?.detected?.parcelGeometry}
            coordinates={detectedMapCoordinates}
          />
        )}
        {detection?.classificationResolution && (detection.classificationResolution.officialLinks?.length ?? 0) > 0 && (
          <div className="bg-background flex flex-wrap gap-3 rounded-lg border p-4 text-xs mt-4">
            {detection.classificationResolution.officialLinks?.map((link) => (
              <a
                key={`${link.kind}-${link.url}`}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1 font-medium hover:underline"
              >
                {link.label} <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 mt-6">
          <div className="grid gap-3">
            <Label htmlFor="address" className="text-base font-medium">Dirección aproximada</Label>
            <Input id="address" name="address" value={address} onChange={(event) => changeLocationInput('address', event.target.value)} placeholder="Se completa desde Catastro cuando está disponible" aria-invalid={createState.field === 'address'} aria-describedby={createState.field === 'address' ? 'creation-error' : undefined} className={`h-12 text-base shadow-sm ${createState.field === 'address' ? 'border-destructive' : ''}`} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label htmlFor="lat" className="text-sm font-medium">Latitud</Label><Input id="lat" name="lat" type="number" step="any" value={lat} onChange={(event) => changeLocationInput('coordinates', event.target.value, 'lat')} aria-invalid={createState.field === 'coordinates'} aria-describedby={createState.field === 'coordinates' ? 'creation-error' : undefined} className={`h-12 ${createState.field === 'coordinates' ? 'border-destructive' : ''}`} /></div>
            <div className="grid gap-2"><Label htmlFor="lng" className="text-sm font-medium">Longitud</Label><Input id="lng" name="lng" type="number" step="any" value={lng} onChange={(event) => changeLocationInput('coordinates', event.target.value, 'lng')} aria-invalid={createState.field === 'coordinates'} aria-describedby={createState.field === 'coordinates' ? 'creation-error' : undefined} className={`h-12 ${createState.field === 'coordinates' ? 'border-destructive' : ''}`} /></div>
          </div>
        </div>
      </section>

      <section className="space-y-6 pt-4">
        <h2 className="border-b pb-2 text-xl font-semibold">C. Contexto urbanístico</h2>
        <div className="grid gap-3">
          <Label htmlFor="planeamiento" className="text-base font-medium">Planeamiento general</Label>
          <select id="planeamiento" name="planeamiento" value={planeamiento} onChange={(event) => setPlaneamiento(event.target.value)} aria-invalid={createState.field === 'planeamiento'} aria-describedby={createState.field === 'planeamiento' ? 'creation-error' : undefined} className={`flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm ${createState.field === 'planeamiento' ? 'border-destructive' : ''}`}>
            <option value="">{detection ? 'No determinado por las fuentes disponibles' : 'Seleccione municipio o detecte la parcela'}</option>
            {detection?.detected.planeamiento && <option value={detection.detected.planeamiento}>{detection.detected.planeamiento}</option>}
            {planningOptions.filter((option) => option !== detection?.detected.planeamiento).map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Las opciones disponibles proceden del catálogo municipal vigente. Si no aparece ninguna, puede dejar este dato pendiente.</p>
        </div>
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="landClass" className="text-base font-medium">Clasificación del suelo</Label>
            {exploredCandidateId && detection?.classificationResolution && (
              classificationManuallyOverridden ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                    <Wand2 className="h-3 w-3" />
                    Modificado manualmente
                  </span>
                  {automaticClassificationCandidate?.id === exploredCandidateId && (
                    <button
                      type="button"
                      onClick={resetToAutoClassification}
                      className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                      data-testid="reset-auto-classification"
                    >
                      Volver a la detección automática
                    </button>
                  )}
                </div>
              ) : selectedClassificationCandidateId === exploredCandidateId ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" data-testid="auto-detected-badge">
                  <Sparkles className="h-3 w-3" />
                  Zona de trabajo
                </span>
              ) : null
            )}
          </div>
          <select
            id="landClass"
            name="landClass"
            value={landClass}
            onChange={(event) => {
              setLandClass(event.target.value)
              setSelectedClassificationCandidateId('')
              if (detection?.classificationResolution) setClassificationManuallyOverridden(true)
            }}
            aria-invalid={createState.field === 'landClass'}
            aria-describedby={createState.field === 'landClass' ? 'creation-error' : undefined}
            className={`flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm ${createState.field === 'landClass' ? 'border-destructive' : ''}`}
          >
            <option value="">Seleccionar si no se ha determinado</option>
            {LAND_CLASS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <Label htmlFor="urbanPlanningZone" className="mt-2 text-sm font-medium">Ámbito o zona</Label>
          <Input
            id="urbanPlanningZone"
            name="urbanPlanningZone"
            value={urbanPlanningZone}
            onChange={(event) => {
              setUrbanPlanningZone(event.target.value)
              setSelectedClassificationCandidateId('')
              if (detection?.classificationResolution) setClassificationManuallyOverridden(true)
            }}
            placeholder="Seleccione o introduzca el ámbito aplicable"
          />
          {detection?.classificationResolution &&
            landClass && classificationManuallyOverridden && (
              <div className="grid gap-2">
                <Label htmlFor="classificationSelectionReason" className="text-sm font-medium">
                  Motivo de la selección manual
                </Label>
                <Textarea
                  id="classificationSelectionReason"
                  name="classificationSelectionReason"
                  value={classificationSelectionReason}
                  onChange={(event) => setClassificationSelectionReason(event.target.value)}
                  placeholder="Indique brevemente la comprobación o criterio profesional utilizado."
                  required
                />
              </div>
            )}
        </div>
      </section>

      <section className="space-y-6 pt-4">
        <h2 className="border-b pb-2 text-xl font-semibold">D. Datos del encargo</h2>
        <div className="grid gap-3">
          <Label htmlFor="actionType" className="text-base font-medium">Tipo de actuación</Label>
          <select id="actionType" name="actionType" value={actionType} onChange={(event) => setActionType(event.target.value)} className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm">
            <option value="">Seleccionar (opcional)</option><option value="consulta_urbanistica">Consulta urbanística</option><option value="informe_urbanistico">Informe urbanístico</option><option value="vivienda_unifamiliar">Vivienda unifamiliar</option><option value="reforma">Reforma</option><option value="segregacion">Segregación</option><option value="parcelacion">Parcelación</option><option value="cambio_de_uso">Cambio de uso</option><option value="nave">Nave industrial/agrícola</option><option value="legalizacion">Legalización</option><option value="demolicion">Demolición</option><option value="otro">Otro</option>
          </select>
        </div>
        <div className="grid gap-3"><Label htmlFor="notes" className="text-base font-medium">Notas / observaciones</Label><Textarea id="notes" name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Añada información relevante del encargo." className="min-h-[100px] resize-y" /></div>
      </section>

      <label className={`flex cursor-pointer items-start gap-3 rounded-md border bg-background p-4 shadow-sm ${createState.field === 'contextNotice' ? 'border-destructive' : ''}`}>
        <input type="checkbox" name="initialContextNoticeAccepted" value="true" checked={contextNoticeAccepted} onChange={(event) => setContextNoticeAccepted(event.target.checked)} required aria-invalid={createState.field === 'contextNotice'} aria-describedby={createState.field === 'contextNotice' ? 'creation-error' : undefined} className="mt-0.5 h-4 w-4 accent-primary" />
        <span className="text-sm font-medium leading-tight">Entiendo que el contexto inicial es orientativo y debe validarse técnicamente antes de utilizarlo.</span>
      </label>
      <div className="flex items-center gap-4 border-t border-border/50 pt-6">
        <Button type="submit" className="h-11 px-8" disabled={isCreating || detectionInvalidated}>
          {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isCreating ? 'Creando expediente...' : 'Crear expediente'}
        </Button>
        <Link href="/dashboard"><Button type="button" variant="ghost" className="h-11">Cancelar</Button></Link>
      </div>
    </form>
  )
}
