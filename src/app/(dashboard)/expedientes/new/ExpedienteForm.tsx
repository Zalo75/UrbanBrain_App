'use client'

import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createExpediente } from "./actions"
import Link from "next/link"
import { Province, Municipality } from '@/shared/territory'

export function ExpedienteForm({ 
  provinces, 
  municipalities 
}: { 
  provinces: Province[], 
  municipalities: Municipality[] 
}) {
  const [selectedProvince, setSelectedProvince] = useState<string>('a_coruna')

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
              defaultValue=""
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
            <Input
              id="refCatastral"
              name="refCatastral"
              placeholder="14 o 20 caracteres"
              className="h-12 text-base shadow-sm font-mono placeholder:font-sans"
            />
          </div>
          <div className="grid gap-3">
            <Label htmlFor="address" className="text-base font-medium">Dirección aproximada</Label>
            <Input
              id="address"
              name="address"
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
