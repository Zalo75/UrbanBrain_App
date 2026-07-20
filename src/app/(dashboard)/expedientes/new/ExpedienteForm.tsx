'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleDashed, Loader2, Sparkles, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Municipality, Province } from '@/shared/territory'

import { createExpediente, detectContextAction, getPlanningOptionsAction } from './actions'
import {
  LAND_CLASS_OPTIONS,
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

function ProgressPanel({ detection, calculating }: { detection: SmartCaseDetection | null; calculating: boolean }) {
  const items = calculating
    ? [
        'Referencia catastral validada', 'Parcela localizada', 'Dirección obtenida', 'Provincia identificada',
        'Municipio identificado', 'Código INE obtenido', 'Coordenadas obtenidas', 'Planeamiento consultado',
        'Clasificación consultada', 'Afecciones consultadas',
      ].map((label, index) => ({ id: String(index), label, status: 'calculating' as const, detail: 'Consultando fuentes oficiales' }))
    : detection?.progress ?? []

  if (!items.length) return null
  const affectsIncomplete = detection?.sourceChecks.some(
    (check) => check.source === 'ideg' && ['partial', 'timeout', 'unavailable', 'malformed'].includes(check.status)
  )
  return (
    <section aria-live="polite" className="rounded-lg border bg-muted/30 p-4">
      <h2 className="text-base font-semibold">Progreso de la detección</h2>
      <p className="mt-1 text-sm text-muted-foreground">Cada estado procede del resultado real de las fuentes consultadas.</p>
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
      {detection && (
        <div className="mt-4 border-t pt-4 text-sm">
          <p className="font-medium">Afecciones y cobertura</p>
          {detection.affects.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {detection.affects.map((affect) => (
                <li key={`${affect.category}-${affect.featureId ?? affect.name}`}>
                  {affect.name} · {affect.confidence} · {affect.evidence.source}
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
                {check.source.toUpperCase()}: {check.message}
              </p>
            ))}
        </div>
      )}
    </section>
  )
}

export function ExpedienteForm({ provinces, municipalities }: { provinces: Province[]; municipalities: Municipality[] }) {
  const [selectedProvince, setSelectedProvince] = useState('a_coruna')
  const [selectedMunicipality, setSelectedMunicipality] = useState('')
  const [refCatastral, setRefCatastral] = useState('')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [planeamiento, setPlaneamiento] = useState('')
  const [landClass, setLandClass] = useState('')
  const [urbanPlanningZone, setUrbanPlanningZone] = useState('')
  const [planningOptionsByMunicipality, setPlanningOptionsByMunicipality] = useState<Record<string, string[]>>({})
  const [detection, setDetection] = useState<SmartCaseDetection | null>(null)
  const [detectionId, setDetectionId] = useState('')
  const [isDetecting, setIsDetecting] = useState(false)

  const availableMunicipalities = useMemo(
    () => municipalitiesForProvince(municipalities, selectedProvince),
    [municipalities, selectedProvince]
  )
  const selectedMunicipalityData = municipalities.find((municipality) => municipality.id === selectedMunicipality)
  const planningOptions = planningOptionsByMunicipality[selectedMunicipality] ?? []

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

  function invalidateDetection() {
    setDetection(null)
    setDetectionId('')
  }

  async function handleDetectContext() {
    if (refCatastral.replace(/[^a-z0-9]/gi, '').length < 14) {
      toast.error('Introduzca una referencia catastral válida (14 o 20 caracteres).')
      return
    }

    setIsDetecting(true)
    try {
      const formData = new FormData()
      formData.append('refCatastral', refCatastral)
      const result = await detectContextAction(formData)
      if ('error' in result) {
        toast.error(result.error)
        return
      }

      const values = result.detection.detected
      setDetection(result.detection)
      setDetectionId(result.detectionId)
      if (values.cadastralReference) setRefCatastral(values.cadastralReference)
      if (values.provinceId) setSelectedProvince(values.provinceId)
      if (values.municipalityId) setSelectedMunicipality(values.municipalityId)
      if (values.address) setAddress(values.address)
      if (values.lat !== undefined) setLat(String(values.lat))
      if (values.lng !== undefined) setLng(String(values.lng))
      if (values.planeamiento) setPlaneamiento(values.planeamiento)
      if (values.landClass) setLandClass(values.landClass)
      if (values.urbanPlanningZone) setUrbanPlanningZone(values.urbanPlanningZone)
      toast.success('Detección completada. Revise los datos antes de crear el expediente.')
    } catch {
      toast.error('No se ha podido completar la detección territorial.')
    } finally {
      setIsDetecting(false)
    }
  }

  return (
    <form action={createExpediente} className="space-y-8">
      <input type="hidden" name="preflightDetectionId" value={detectionId} />
      <input type="hidden" name="urbanPlanningZone" value={urbanPlanningZone} />

      <section className="space-y-6">
        <h2 className="border-b pb-2 text-xl font-semibold">A. Identificación</h2>
        <div className="grid gap-3">
          <Label htmlFor="name" className="text-base font-medium">Nombre del proyecto <span className="text-destructive">*</span></Label>
          <Input id="name" name="name" placeholder="Ej.: Reforma vivienda unifamiliar" required className="h-12 text-base shadow-sm" autoFocus />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="grid gap-3">
            <Label htmlFor="province" className="text-base font-medium">Provincia <span className="text-destructive">*</span></Label>
            <select
              id="province" name="province" required value={selectedProvince}
              onChange={(event) => {
                const provinceId = event.target.value
                setSelectedProvince(provinceId)
                if (selectedMunicipalityData?.provinceId !== provinceId) setSelectedMunicipality('')
                invalidateDetection()
              }}
              className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm"
            >
              {provinces.map((province) => <option key={province.id} value={province.id} disabled={!province.enabled}>{province.name}</option>)}
            </select>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="municipio" className="text-base font-medium">Municipio <span className="text-destructive">*</span></Label>
            <select
              id="municipio" name="municipio" required value={selectedMunicipality}
              onChange={(event) => { setSelectedMunicipality(event.target.value); invalidateDetection() }}
              className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm"
            >
              <option value="" disabled>Seleccione un municipio</option>
              {availableMunicipalities.map((municipality) => (
                <option key={municipality.id} value={municipality.id} disabled={!municipality.enabled}>{municipality.name}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Se guarda el identificador estable del catálogo; no se admiten variantes de texto libre.</p>
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
              onChange={(event) => { setRefCatastral(event.target.value); invalidateDetection() }}
              placeholder="14 o 20 caracteres" className="h-12 flex-1 font-mono text-base shadow-sm"
            />
            <Button type="button" variant="secondary" className="h-12 px-4" onClick={handleDetectContext} disabled={isDetecting}>
              {isDetecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-amber-500" />}
              <span className="ml-2 hidden sm:inline">Detectar</span>
            </Button>
          </div>
          {detection?.detected.parcelReference && <p className="text-sm text-muted-foreground">Referencia parcelaria: <span className="font-mono">{detection.detected.parcelReference}</span></p>}
        </div>
        <ProgressPanel detection={detection} calculating={isDetecting} />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="grid gap-3">
            <Label htmlFor="address" className="text-base font-medium">Dirección aproximada</Label>
            <Input id="address" name="address" value={address} onChange={(event) => { setAddress(event.target.value); invalidateDetection() }} placeholder="Se completa desde Catastro cuando está disponible" className="h-12 text-base shadow-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label htmlFor="lat" className="text-sm font-medium">Latitud</Label><Input id="lat" name="lat" type="number" step="any" value={lat} onChange={(event) => { setLat(event.target.value); invalidateDetection() }} className="h-12" /></div>
            <div className="grid gap-2"><Label htmlFor="lng" className="text-sm font-medium">Longitud</Label><Input id="lng" name="lng" type="number" step="any" value={lng} onChange={(event) => { setLng(event.target.value); invalidateDetection() }} className="h-12" /></div>
          </div>
        </div>
      </section>

      <section className="space-y-6 pt-4">
        <h2 className="border-b pb-2 text-xl font-semibold">C. Contexto urbanístico</h2>
        <div className="grid gap-3">
          <Label htmlFor="planeamiento" className="text-base font-medium">Planeamiento general</Label>
          <select id="planeamiento" name="planeamiento" value={planeamiento} onChange={(event) => setPlaneamiento(event.target.value)} className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm">
            <option value="">{detection ? 'No determinado por las fuentes disponibles' : 'Seleccione municipio o detecte la parcela'}</option>
            {detection?.detected.planeamiento && <option value={detection.detected.planeamiento}>{detection.detected.planeamiento}</option>}
            {planningOptions.filter((option) => option !== detection?.detected.planeamiento).map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Las opciones manuales proceden exclusivamente del catálogo municipal vigente disponible para el municipio seleccionado.</p>
        </div>
        <div className="grid gap-3">
          <Label htmlFor="landClass" className="text-base font-medium">Clasificación del suelo</Label>
          <select id="landClass" name="landClass" value={landClass} onChange={(event) => setLandClass(event.target.value)} className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm">
            <option value="">Seleccionar si no se ha determinado</option>
            {LAND_CLASS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {detection?.detected.urbanPlanningZone && <p className="text-sm text-muted-foreground">Ámbito detectado: {detection.detected.urbanPlanningZone}</p>}
        </div>
      </section>

      <section className="space-y-6 pt-4">
        <h2 className="border-b pb-2 text-xl font-semibold">D. Datos del encargo</h2>
        <div className="grid gap-3">
          <Label htmlFor="actionType" className="text-base font-medium">Tipo de actuación</Label>
          <select id="actionType" name="actionType" className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm">
            <option value="">Seleccionar (opcional)</option><option value="consulta_urbanistica">Consulta urbanística</option><option value="informe_urbanistico">Informe urbanístico</option><option value="vivienda_unifamiliar">Vivienda unifamiliar</option><option value="reforma">Reforma</option><option value="segregacion">Segregación</option><option value="parcelacion">Parcelación</option><option value="cambio_de_uso">Cambio de uso</option><option value="nave">Nave industrial/agrícola</option><option value="legalizacion">Legalización</option><option value="demolicion">Demolición</option><option value="otro">Otro</option>
          </select>
        </div>
        <div className="grid gap-3"><Label htmlFor="notes" className="text-base font-medium">Notas / observaciones</Label><Textarea id="notes" name="notes" placeholder="Añada información relevante del encargo." className="min-h-[100px] resize-y" /></div>
      </section>

      <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-4 shadow-sm">
        <input type="checkbox" name="initialContextNoticeAccepted" value="true" required className="mt-0.5 h-4 w-4 accent-primary" />
        <span className="text-sm font-medium leading-tight">Entiendo que el contexto inicial es orientativo y debe validarse técnicamente antes de utilizarlo.</span>
      </label>
      <div className="flex items-center gap-4 border-t border-border/50 pt-6">
        <Button type="submit" className="h-11 px-8">Crear expediente</Button>
        <Link href="/dashboard"><Button type="button" variant="ghost" className="h-11">Cancelar</Button></Link>
      </div>
    </form>
  )
}
