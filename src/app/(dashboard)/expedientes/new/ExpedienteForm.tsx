'use client'

import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createExpediente, detectContextAction } from "./actions"
import Link from "next/link"
import { Province, Municipality } from '@/shared/territory'
import { toast } from "sonner"
import { Sparkles, Loader2 } from "lucide-react"

export function ExpedienteForm({ 
  provinces, 
  municipalities 
}: { 
  provinces: Province[], 
  municipalities: Municipality[] 
}) {
  const [selectedProvince, setSelectedProvince] = useState<string>('a_coruna')
  const [selectedMunicipality, setSelectedMunicipality] = useState<string>('')
  const [refCatastral, setRefCatastral] = useState<string>('')
  const [address, setAddress] = useState<string>('')
  const [isDetecting, setIsDetecting] = useState(false)

  const handleDetectContext = async () => {
    if (!refCatastral || refCatastral.length < 14) {
      toast.error("Introduzca una referencia catastral válida (mín. 14 caracteres).")
      return
    }

    setIsDetecting(true)
    try {
      const formData = new FormData()
      formData.append('refCatastral', refCatastral)
      
      const result = await detectContextAction(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        let changed = false
        if (result.provinceId) {
          setSelectedProvince(result.provinceId)
          changed = true
        }
        if (result.municipalityId) {
          setSelectedMunicipality(result.municipalityId)
          changed = true
        }
        if (result.address) {
          setAddress(result.address)
          changed = true
        }
        
        if (changed) {
          toast.success("Datos de localización detectados automáticamente. Revise y corrija el contexto antes de confirmar.")
        } else {
          toast.info("No se han podido mapear los datos detectados automáticamente.")
        }
      }
    } catch {
      toast.error("Error al detectar el contexto.")
    } finally {
      setIsDetecting(false)
    }
  }

  const availableMunicipalities = municipalities.filter(
    m => m.provinceId === selectedProvince
  )

  return (
    <form action={createExpediente} className="space-y-8">
      {/* SECCIÓN A: Identificación */}
      <div className="space-y-6">
        <h2 className="text-xl font-semibold border-b pb-2">A. Identificación</h2>
        
        <div className="grid gap-3">
          <Label htmlFor="name" className="text-base font-medium">Nombre del Proyecto <span className="text-destructive">*</span></Label>
          <Input
            id="name"
            name="name"
            placeholder="Ej: Reforma Vivienda Unifamiliar"
            required
            className="h-12 text-base shadow-sm"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="grid gap-3">
            <Label htmlFor="province" className="text-base font-medium">Provincia <span className="text-destructive">*</span></Label>
            <select
              id="province"
              name="province"
              required
              value={selectedProvince}
              onChange={(e) => setSelectedProvince(e.target.value)}
              className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {provinces.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.enabled}>
                  {p.name} {p.enabled ? '' : '(Próximamente)'}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="municipio" className="text-base font-medium">Municipio <span className="text-destructive">*</span></Label>
            <select
              id="municipio"
              name="municipio"
              required
              value={selectedMunicipality}
              onChange={(e) => setSelectedMunicipality(e.target.value)}
              className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>Selecciona un municipio</option>
              {availableMunicipalities.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.enabled}>
                  {m.name} {m.enabled ? '' : '(No disponible)'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-3">
          <Label htmlFor="planeamiento" className="text-base font-medium">Planeamiento General</Label>
          <Input
            id="planeamiento"
            name="planeamiento"
            placeholder="Ej: PGOU 2013, NNSS..."
            className="h-12 text-base shadow-sm"
          />
        </div>
      </div>

      {/* SECCIÓN B: Localización */}
      <div className="space-y-6 pt-4">
        <h2 className="text-xl font-semibold border-b pb-2">B. Localización</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Debe existir al menos uno de estos datos (Referencia catastral, dirección o coordenadas).
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="grid gap-3">
            <Label htmlFor="refCatastral" className="text-base font-medium">Referencia Catastral</Label>
            <div className="flex gap-2">
              <Input
                id="refCatastral"
                name="refCatastral"
                value={refCatastral}
                onChange={(e) => setRefCatastral(e.target.value)}
                placeholder="14 o 20 caracteres"
                className="h-12 text-base shadow-sm font-mono placeholder:font-sans flex-1"
              />
              <Button 
                type="button" 
                variant="secondary" 
                className="h-12 px-4"
                onClick={handleDetectContext}
                disabled={isDetecting}
              >
                {isDetecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-amber-500" />}
                <span className="ml-2 hidden sm:inline">Detectar</span>
              </Button>
            </div>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="address" className="text-base font-medium">Dirección aproximada</Label>
            <Input
              id="address"
              name="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ej: Rúa do Franco 14"
              className="h-12 text-base shadow-sm"
            />
          </div>
        </div>

        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-4">
          <p className="text-sm text-amber-800 dark:text-amber-400 mb-4">
            La dirección y las coordenadas introducidas son orientativas y deberán verificarse con fuentes oficiales.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="lat" className="text-sm font-medium">Latitud</Label>
              <Input
                id="lat"
                name="lat"
                type="number"
                step="any"
                placeholder="Ej: 42.8805"
                className="bg-background"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lng" className="text-sm font-medium">Longitud</Label>
              <Input
                id="lng"
                name="lng"
                type="number"
                step="any"
                placeholder="Ej: -8.5456"
                className="bg-background"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="locationSource" className="text-sm font-medium">Fuente (Opcional)</Label>
              <select
                id="locationSource"
                name="locationSource"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Seleccionar...</option>
                <option value="cadastral_reference">Catastro</option>
                <option value="address">Dirección manual</option>
                <option value="coordinates">Coordenadas exactas</option>
                <option value="planning_area">Ámbito de planeamiento</option>
                <option value="manual">Manual / Otra</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* SECCIÓN C: Datos Urbanísticos */}
      <div className="space-y-6 pt-4">
        <h2 className="text-xl font-semibold border-b pb-2">C. Datos Urbanísticos</h2>
        
        <div className="grid gap-3">
          <Label htmlFor="urbanPlanningZone" className="text-base font-medium">Ordenanza o ámbito urbanístico (si lo conoces)</Label>
          <Input
            id="urbanPlanningZone"
            name="urbanPlanningZone"
            placeholder="Ej: SU-1, Ensanche, APR-2..."
            className="h-12 text-base shadow-sm"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="grid gap-3">
            <Label htmlFor="landClass" className="text-base font-medium">Clase de suelo</Label>
            <select
              id="landClass"
              name="landClass"
              className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Seleccionar (Opcional)</option>
              <option value="desconocido">Desconocido</option>
              <option value="urbano_consolidado">Urbano Consolidado</option>
              <option value="urbano_no_consolidado">Urbano No Consolidado</option>
              <option value="urbanizable">Urbanizable</option>
              <option value="rustico_no_urbanizable">Rústico / No Urbanizable</option>
              <option value="nucleo_rural">Núcleo Rural</option>
            </select>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="actionType" className="text-base font-medium">Tipo de actuación</Label>
            <select
              id="actionType"
              name="actionType"
              className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Seleccionar (Opcional)</option>
              <option value="consulta_urbanistica">Consulta Urbanística</option>
              <option value="informe_urbanistico">Informe Urbanístico</option>
              <option value="vivienda_unifamiliar">Vivienda Unifamiliar</option>
              <option value="reforma">Reforma</option>
              <option value="segregacion">Segregación</option>
              <option value="parcelacion">Parcelación</option>
              <option value="cambio_de_uso">Cambio de Uso</option>
              <option value="nave">Nave Industrial/Agrícola</option>
              <option value="legalizacion">Legalización</option>
              <option value="demolicion">Demolición</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        </div>

        <div className="grid gap-3">
          <Label htmlFor="notes" className="text-base font-medium">Notas / Observaciones</Label>
          <Textarea
            id="notes"
            name="notes"
            placeholder="Añade cualquier comentario relevante sobre el estado actual, intenciones del cliente, etc."
            className="min-h-[100px] resize-y"
          />
        </div>
      </div>

      <div className="pt-2">
        <label className="flex items-start gap-3 p-4 border rounded-md bg-background shadow-sm cursor-pointer hover:bg-muted/30 transition-colors">
          <input 
            type="checkbox" 
            name="initialContextNoticeAccepted"
            value="true"
            required
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer accent-primary"
          />
          <span className="text-sm font-medium leading-tight text-foreground">
            Entiendo que el contexto inicial es orientativo y debe validarse técnicamente antes de utilizarlo.
          </span>
        </label>
      </div>

      <div className="flex items-center gap-4 pt-6 border-t border-border/50">
        <Button type="submit" className="h-11 px-8">
          Crear Expediente
        </Button>
        <Link href="/dashboard">
          <Button type="button" variant="ghost" className="h-11 text-muted-foreground hover:text-foreground">
            Cancelar
          </Button>
        </Link>
      </div>
    </form>
  )
}
