'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPinned,
  Search,
} from 'lucide-react';

import type { TerritorialContextView } from '@/application/territorial-resolver/territorialContextView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ActiveZoneContext } from '@/components/territorial/ActiveZoneContext'
import { AvailableZonesSummary } from '@/components/territorial/AvailableZonesSummary'
import { GeometricAuditAccordion } from '@/components/territorial/GeometricAuditAccordion'
import { MapcentricWorkspace } from '@/components/territorial/MapcentricWorkspace'
import { ParcelMap } from '@/components/maps/ParcelMap';
import { PordPlanViewer } from '@/components/territorial/PordPlanViewer';
import {
  resolveTerritorialContextAction,
  type TerritorialResolutionActionState,
} from './territorialActions';

interface Props {
  expedienteId: string;
  initialInput: {
    cadastralReference?: string | null;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
  };
  context: TerritorialContextView | null;
}

const initialState: TerritorialResolutionActionState = { status: 'idle', message: '' };

const statusCopy = {
  confirmed: { label: 'Confirmado', className: 'bg-emerald-100 text-emerald-800' },
  approximate: { label: 'Aproximado', className: 'bg-sky-100 text-sky-800' },
  conflict: { label: 'Conflictivo', className: 'bg-amber-100 text-amber-900' },
  undetermined: { label: 'No determinado', className: 'bg-zinc-200 text-zinc-800' },
  provisional: { label: 'Parcial', className: 'bg-violet-100 text-violet-900' },
} as const;

function confidenceLabel(confidence: TerritorialContextView['confidence']) {
  return confidence === 'high' ? 'Alta' : confidence === 'medium' ? 'Media' : 'Baja';
}

export function TerritorialContextPanel({
  expedienteId,
  initialInput,
  context,
}: Props) {
  const router = useRouter();
  const action = resolveTerritorialContextAction.bind(null, expedienteId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualAffectAddOpen, setManualAffectAddOpen] = useState(false);
  const [exploredCandidateId, setExploredCandidateId] = useState<string | undefined>(undefined);
  const manualOrdinanceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [router, state.status]);

  const persistedCandidateId = context?.actionArea?.selectedCandidateId;
  const activeCandidateId = exploredCandidateId !== undefined ? exploredCandidateId : persistedCandidateId;
  const classificationIsTechnicallyValidated = Boolean(
    context?.classificationOrigin === 'manual' &&
      (context.actionArea?.verification === 'technician_validated' ||
        context.manualContext?.verification === 'technician_validated')
  );
  const classificationHeading = classificationIsTechnicallyValidated
    ? 'Clasificación efectiva'
    : 'Clasificación detectada';
  const classificationOriginCopy = classificationIsTechnicallyValidated
    ? 'Decisión del técnico'
    : context?.classificationOrigin === 'manual'
      ? context.actionArea
        ? 'Zona de trabajo seleccionada; pendiente de validación técnica'
        : 'Selección manual pendiente de validación técnica'
      : context?.classificationOrigin === 'automatic'
        ? 'Detección automática'
        : 'Desconocido';

  const status = context ? statusCopy[context.status] : statusCopy.undetermined;
  const affectsFullyChecked = context?.sourceChecks.some(
    (check) => check.source === 'ideg' && check.status === 'available'
  );
  const displayedAutomaticAffects =
    context?.automaticAffects ??
    context?.affects
      .filter((affect) => affect.origin !== 'manual')
      .map((affect) => ({
        key: affect.key ?? `legacy:${affect.category}:${affect.name}`,
        category: affect.category,
        name: affect.name,
        confidence: affect.confidence,
        source: 'ideg',
      })) ??
    [];

  return (
    <details
      className="group border-b bg-zinc-50/70 dark:bg-zinc-950/30"
      open
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <MapPinned className="text-muted-foreground h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">Diagnóstico territorial</h2>
            <p className="text-muted-foreground truncate text-xs">
              {context?.municipality ?? 'Pendiente de resolución oficial'}
              {context?.cadastralReference ? ` · ${context.cadastralReference}` : ''}
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${status.className}`}
        >
          {status.label}
        </span>
      </summary>

      <div className="max-h-[52vh] overflow-y-auto border-t px-4 py-4 lg:px-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
          <form
            action={formAction}
            aria-labelledby="territorial-form-heading"
            className="bg-background space-y-4 rounded-lg border p-4"
          >
            <div>
              <h3 id="territorial-form-heading" className="text-sm font-semibold">
                Resolver localización
              </h3>
              <p className="text-muted-foreground mt-1 text-xs">
                Prioridad: referencia catastral, coordenadas y, por último, dirección. El municipio
                se obtiene siempre de las fuentes oficiales.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="territorial-rc">Referencia catastral</Label>
              <Input
                id="territorial-rc"
                name="refCatastral"
                defaultValue={initialInput.cadastralReference ?? ''}
                className="font-mono"
                placeholder="14, 18 o 20 caracteres"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setManualOpen(true)}
              disabled={pending || manualOpen}
              className="w-full sm:w-fit"
            >
              Introducir datos manualmente
            </Button>
            {manualOpen && (
              <fieldset className="rounded-md border border-dashed p-3">
                <legend className="px-1 text-sm font-medium">Datos manuales provisionales</legend>
              <p className="text-muted-foreground mt-2 text-xs">
                Se guardar&aacute;n como manuales y nunca se presentar&aacute;n como una comprobaci&oacute;n oficial.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="manualAffectsEdited" value="1" />
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="territorial-manual-municipality">Municipio conocido</Label>
                  <Input
                    id="territorial-manual-municipality"
                    name="manualMunicipality"
                    defaultValue={context?.manualContext?.municipality ?? ''}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="territorial-manual-classification">Clasificaci&oacute;n</Label>
                  <Input
                    id="territorial-manual-classification"
                    name="manualClassification"
                    defaultValue={context?.manualContext?.classification ?? ''}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="territorial-manual-category">Categor&iacute;a</Label>
                  <Input
                    id="territorial-manual-category"
                    name="manualCategory"
                    defaultValue={context?.manualContext?.category ?? ''}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="territorial-manual-area">N&uacute;cleo o &aacute;mbito</Label>
                  <Input
                    id="territorial-manual-area"
                    name="manualArea"
                    defaultValue={context?.manualContext?.area ?? ''}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="territorial-manual-ordinance">Ordenanza conocida</Label>
                  <Input
                    id="territorial-manual-ordinance"
                    name="manualOrdinance"
                    ref={manualOrdinanceRef}
                    defaultValue={context?.manualContext?.ordinance ?? ''}
                  />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="territorial-manual-observations">
                    Observaciones del t&eacute;cnico
                  </Label>
                  <Textarea
                    id="territorial-manual-observations"
                    name="manualObservations"
                    defaultValue={context?.manualContext?.observations ?? ''}
                    maxLength={1000}
                    placeholder="Información conocida, dudas o comprobaciones pendientes"
                  />
                </div>
                <div className="grid gap-3 sm:col-span-2">
                  <p className="text-sm font-medium">Revisión manual de afecciones</p>
                  {displayedAutomaticAffects.map((affect, index) => {
                    const decision = context?.manualContext?.affectDecisions?.find(
                      (item) => item.targetKey === affect.key
                    );
                    return (
                      <div key={affect.key} className="rounded-md border p-3">
                        <p className="text-xs font-medium">{affect.name}</p>
                        <p className="text-muted-foreground text-xs">
                          Automática · {affect.source.toUpperCase()}
                        </p>
                        <div
                          className="mt-2 flex flex-wrap gap-2"
                          role="group"
                          aria-label={`Decisión sobre ${affect.name}`}
                        >
                          <label className="cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50">
                            <input
                              type="radio"
                              name={`manualAffectAction.${index}`}
                              value="confirm"
                              defaultChecked={decision?.action === 'confirm'}
                              className="sr-only"
                            />
                            Confirmar
                          </label>
                          <label className="cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium has-[:checked]:border-red-600 has-[:checked]:bg-red-50">
                            <input
                              type="radio"
                              name={`manualAffectAction.${index}`}
                              value="exclude"
                              defaultChecked={decision?.action === 'exclude'}
                              className="sr-only"
                            />
                            Excluir
                          </label>
                        </div>
                        <Input
                          className="mt-2"
                          name={`manualAffectReason.${index}`}
                          defaultValue={decision?.reason ?? ''}
                          maxLength={500}
                          placeholder="Motivo de la decisión (obligatorio al excluir)"
                        />
                      </div>
                    );
                  })}
                  {(context?.manualContext?.affectDecisions ?? [])
                    .filter((decision) => decision.action === 'add')
                    .map((decision, index) => (
                      <div key={decision.id} className="rounded-md border border-violet-200 p-3">
                        <label className="flex items-start gap-2 text-xs">
                          <input
                            type="checkbox"
                            name={`manualAddedAffectIncluded.${index}`}
                            defaultChecked
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block font-medium">{decision.name}</span>
                            <span className="text-muted-foreground">Manual</span>
                          </span>
                        </label>
                        <Input
                          className="mt-2"
                          name={`manualAddedAffectReason.${index}`}
                          defaultValue={decision.reason}
                          maxLength={500}
                        />
                      </div>
                    ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit"
                    onClick={() => setManualAffectAddOpen((open) => !open)}
                  >
                    Añadir afección
                  </Button>
                  {manualAffectAddOpen && (
                    <div className="grid gap-2 rounded-md border border-dashed p-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="territorial-manual-affect-category">Categoría nueva</Label>
                        <Input id="territorial-manual-affect-category" name="manualAffectCategory" />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="territorial-manual-affect-name">Afección nueva</Label>
                        <Input id="territorial-manual-affect-name" name="manualAffectName" />
                      </div>
                      <div className="grid gap-2 sm:col-span-2">
                        <Label htmlFor="territorial-manual-affect-reason">Motivo</Label>
                        <Input
                          id="territorial-manual-affect-reason"
                          name="manualAffectAddReason"
                          maxLength={500}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <label className="flex items-start gap-2 text-xs sm:col-span-2">
                  <input
                    type="checkbox"
                    name="technicianValidated"
                    defaultChecked={
                      context?.manualContext?.verification === 'technician_validated'
                    }
                    className="mt-0.5"
                  />
                  Confirmo que un t&eacute;cnico ha revisado expresamente estos datos manuales.
                </label>
              </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="submit"
                    name="intent"
                    value="manual"
                    variant="outline"
                    disabled={pending}
                    className="w-full sm:w-auto"
                  >
                    Guardar manual y continuar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setManualOpen(false)}
                    className="w-full sm:w-auto"
                  >
                    Cancelar edici&oacute;n manual
                  </Button>
                </div>
              </fieldset>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="territorial-lat">Latitud</Label>
                <Input
                  id="territorial-lat"
                  name="lat"
                  type="number"
                  step="any"
                  defaultValue={initialInput.lat ?? ''}
                  placeholder="43.000000"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="territorial-lng">Longitud</Label>
                <Input
                  id="territorial-lng"
                  name="lng"
                  type="number"
                  step="any"
                  defaultValue={initialInput.lng ?? ''}
                  placeholder="-8.000000"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="territorial-address">Dirección</Label>
              <Input
                id="territorial-address"
                name="address"
                defaultValue={initialInput.address ?? ''}
                placeholder="Dirección completa"
              />
            </div>
            {state.message && (
              <p
                aria-live="polite"
                role={state.status === 'error' ? 'alert' : 'status'}
                className={`text-xs ${state.status === 'error' ? 'text-destructive' : 'text-emerald-700'}`}
              >
                {state.message}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="submit"
                name="intent"
                value="resolve"
                disabled={pending}
                className="w-full sm:w-auto"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {context ? 'Reintentar comprobaci\u00f3n' : 'Resolver contexto'}
              </Button>
            </div>
          </form>

          <div className="space-y-4">
            {!context ? (
              <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
                Introduzca una localización para consultar Catastro, SIOTUGA y las capas oficiales
                disponibles.
              </div>
            ) : (
              <>
                {(context.usingPreviousOfficialContext || context.manualContext) && (
                  <div
                    role="status"
                    className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-violet-950"
                  >
                    <h3 className="text-sm font-semibold">Contexto provisional</h3>
                    <p className="mt-1 text-xs">
                      {context.usingPreviousOfficialContext
                        ? 'La comprobaci\u00f3n m\u00e1s reciente no pudo completarse. Se mantiene el \u00faltimo contexto oficial v\u00e1lido para esta misma parcela.'
                        : context.manualContext?.verification === 'technician_validated'
                          ? 'Se muestran datos manuales validados por un t\u00e9cnico, diferenciados de la comprobaci\u00f3n oficial.'
                          : 'Se muestran datos manuales no verificados. No habilitan par\u00e1metros urban\u00edsticos concretos.'}
                    </p>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="bg-background rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">Ubicación</p>
                    <p className="mt-1 text-sm font-medium">
                      {context.municipality ?? 'Municipio no determinado'}
                      {context.municipalityCode ? ` (${context.municipalityCode})` : ''}
                    </p>
                    <p className="mt-1 text-xs">{context.address ?? 'Dirección no determinada'}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Confianza {confidenceLabel(context.confidence).toLowerCase()}
                    </p>
                  </div>
                  <div className="bg-background rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-muted-foreground text-xs">Clasificación / categoría</p>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setManualOpen(true)}>
                        Editar clasificación
                      </Button>
                    </div>
                    <div className="mt-1">
                      <p className="text-[11px] font-semibold text-emerald-700">{classificationHeading}</p>
                      {context.classification ? (
                        <>
                        <p className="text-sm font-medium">{context.classification.label || context.classification.code}</p>
                        <p className="font-mono text-xs">
                          {context.classification.code}
                          {context.classification.categoryCode
                            ? ` · ${context.classification.categoryCode}`
                            : ''}
                        </p>
                        </>
                      ) : (
                        <p className="text-muted-foreground text-sm">No determinada</p>
                      )}
                      <p className="text-muted-foreground mt-1 text-[10px]">
                        Origen: {classificationOriginCopy}
                      </p>
                    </div>

                    {context.classificationOrigin === 'manual' && context.automaticClassification && (
                      <div className="mt-2 border-t pt-2">
                        <p className="text-[11px] font-semibold text-muted-foreground">
                          Clasificación automática original
                        </p>
                        <p className="text-xs">{context.automaticClassification.label}</p>
                      </div>
                    )}

                    {context.manualContext?.classification && (
                      <div className="mt-2 border-t pt-2">
                        <p className="text-[11px] font-semibold text-violet-700">
                          Auditoría manual legacy
                        </p>
                        <p className="text-xs">{context.manualContext.classification} {context.manualContext.category ? `(${context.manualContext.category})` : ''}</p>
                      </div>
                    )}
                  </div>
                  <div className="bg-background rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">Planeamiento</p>
                    <p className="mt-1 text-sm font-medium">
                      {context.instrument ?? 'Planeamiento no determinado'}
                    </p>
                    {context.areas.length > 0 && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        Ámbito: {context.areas.join(', ')}
                      </p>
                    )}
                  </div>
                </div>

                {context.classificationResolution && (
                  <MapcentricWorkspace
                    mapSlot={
                      <ParcelMap
                        geometry={context.parcelGeometry}
                        coordinates={context.coordinates}
                        candidates={context.classificationResolution.candidates}
                        selectedCandidateId={activeCandidateId}
                        onCandidateSelect={(candidateId) => setExploredCandidateId(candidateId)}
                      />
                    }
                    activeZoneSlot={
                      <div className="flex flex-col gap-4">
                        {persistedCandidateId ? (
                          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:bg-emerald-950/20">
                            <div className="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-400 mb-2">
                              <CheckCircle2 className="h-5 w-5" />
                              Zona de trabajo confirmada
                            </div>
                            <p className="text-sm text-emerald-800 dark:text-emerald-300">
                              Esta zona se está utilizando como ámbito territorial del expediente.
                            </p>
                            <form action={formAction} className="mt-3 flex flex-wrap gap-2">
                              <input type="hidden" name="intent" value="manual" />
                              <input type="hidden" name="actionAreaEdited" value="1" />
                              <Button type="submit" name="actionAreaMode" value="revoke" variant="outline" size="sm" disabled={pending}>
                                Volver a parcela completa
                              </Button>
                            </form>
                          </div>
                        ) : (
                          <div className="rounded-md border border-sky-200 bg-sky-50 p-4 dark:bg-sky-950/20">
                            <h3 className="font-semibold text-sky-900 dark:text-sky-400">Parcela completa (Estado actual)</h3>
                            <p className="mt-1 text-sm text-sky-800 dark:text-sky-300">
                              {context.classificationResolution.candidates.length > 1
                                ? 'Se han detectado varias zonas. Selecciona la zona sobre la que deseas trabajar haciendo clic en el mapa.'
                                : 'No se ha fijado una zona de trabajo específica.'}
                            </p>
                          </div>
                        )}

                        {activeCandidateId && (() => {
                          const candidate = context.classificationResolution!.candidates.find(c => c.id === activeCandidateId);
                          if (!candidate) return null;
                          return (
                            <div className="flex flex-col gap-3">
                              <ActiveZoneContext candidate={candidate} />

                              {persistedCandidateId !== activeCandidateId && (
                                <form action={formAction} className="flex justify-end border-t pt-3">
                                  <input type="hidden" name="intent" value="manual" />
                                  <input type="hidden" name="actionAreaEdited" value="1" />
                                  <input type="hidden" name="actionAreaCandidateId" value={activeCandidateId} />
                                  <input type="hidden" name="actionAreaValidated" value="on" />
                                  <input type="hidden" name="refCatastral" value={context.cadastralReference ?? initialInput.cadastralReference ?? ''} />
                                  <input type="hidden" name="address" value={context.address ?? initialInput.address ?? ''} />
                                  {Number.isFinite(context.coordinates?.lat ?? initialInput.lat) ? <input type="hidden" name="lat" value={context.coordinates?.lat ?? initialInput.lat ?? ''} /> : null}
                                  {Number.isFinite(context.coordinates?.lng ?? initialInput.lng) ? <input type="hidden" name="lng" value={context.coordinates?.lng ?? initialInput.lng ?? ''} /> : null}
                                  <Button type="submit" name="actionAreaMode" value="detected_zone" disabled={pending}>
                                    Fijar como Zona de Trabajo
                                  </Button>
                                  {persistedCandidateId && (
                                    <Button type="button" variant="ghost" className="ml-2" onClick={() => setExploredCandidateId(undefined)} disabled={pending}>
                                      Cancelar
                                    </Button>
                                  )}
                                </form>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    }
                    availableZonesSlot={
                      <AvailableZonesSummary
                        candidates={context.classificationResolution.candidates.filter(c => c.id !== activeCandidateId)}
                        onSelect={(id) => setExploredCandidateId(id)}
                      />
                    }
                    auditSlot={
                      <GeometricAuditAccordion
                        totalParcelArea={context.parcelSurfaceSquareMetres ?? 0}
                        candidates={context.classificationResolution.candidates}
                      />
                    }
                  />
                )}
                {context && !context.classificationResolution && (
                  <ParcelMap
                    geometry={context.parcelGeometry}
                    coordinates={context.coordinates}
                  />
                )}
                {context && !context.classificationResolution && (context.officialLinks?.length ?? 0) > 0 && (
                  <div className="bg-background flex flex-wrap gap-3 rounded-lg border p-4 text-xs">
                    {context.officialLinks?.map((link) => (
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

                <div className="bg-background rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold">Afecciones</h3>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setManualOpen(true)}>
                      Editar afecciones
                    </Button>
                  </div>
                  {displayedAutomaticAffects.length > 0 ? (
                    <ul className="mt-2 space-y-2 text-sm">
                      {displayedAutomaticAffects.map((affect) => {
                        const decision = context.manualContext?.affectDecisions?.find(
                          (item) => item.targetKey === affect.key
                        );
                        return (
                        <li key={affect.key} className="flex gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <span>
                            {affect.name}
                            <span className="text-muted-foreground block text-xs">
                              Automática · {affect.source.toUpperCase()}
                              {decision
                                ? ` · ${decision.action === 'exclude' ? 'excluida operativamente' : 'confirmada manualmente'}`
                                : ''}
                            </span>
                          </span>
                        </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground mt-2 text-sm">
                      {affectsFullyChecked
                        ? 'No se detectaron afecciones positivas en las comprobaciones completadas.'
                        : 'La comprobación de afecciones no está completa; no equivale a ausencia de afecciones.'}
                    </p>
                  )}
                  {!context.canRuleOutUndetectedAffects && (
                    <p className="mt-3 text-xs text-amber-800">
                      La cobertura es parcial: este resultado no demuestra ausencia de otras
                      afecciones.
                    </p>
                  )}
                </div>

                {(context.conflicts.length > 0 || context.warnings.length > 0) && (
                  <div
                    role="alert"
                    className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950"
                  >
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <AlertTriangle className="h-4 w-4" /> Advertencias y conflictos
                    </h3>
                    <ul className="mt-2 space-y-1 text-xs">
                      {[...context.conflicts, ...context.warnings].map((item, index) => (
                        <li key={`${item}-${index}`}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {context.sourceChecks.length > 0 && (
                  <div role="status" className="bg-background rounded-lg border p-4">
                    <h3 className="text-sm font-semibold">Estado de las fuentes oficiales</h3>
                    <ul className="mt-2 space-y-2 text-xs">
                      {context.sourceChecks.map((check, index) => (
                        <li key={`${check.source}-${check.checkedAt}-${index}`}>
                          <span className="font-medium">{check.source.toUpperCase()}:</span>{' '}
                          {check.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="bg-background rounded-lg border p-4">
                  <h3 className="text-sm font-semibold">Procedencia</h3>
                  <ul className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    {context.sources.map((source) => (
                      <li key={`${source.source}-${source.sourceUrl}-${source.method}`}>
                        <a
                          href={source.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary inline-flex items-start gap-1 hover:underline"
                        >
                          <span>
                            {source.source.toUpperCase()} · {source.method}
                          </span>
                          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                        </a>
                        <p className="text-muted-foreground mt-0.5">
                          Consultado: {new Date(source.retrievedAt).toLocaleString('es-ES')}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground mt-3 text-xs">
                    &Uacute;ltimo intento: {new Date(context.latestAttemptAt).toLocaleString('es-ES')}
                  </p>
                  {context.officialContextResolvedAt && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Contexto oficial utilizado:{' '}
                      {new Date(context.officialContextResolvedAt).toLocaleString('es-ES')}
                    </p>
                  )}
                  {context.manualContext && (
                    <p className="mt-2 text-xs text-violet-800">
                      Procedencia manual · registrado el{' '}
                      {new Date(context.manualContext.recordedAt).toLocaleString('es-ES')} ·{' '}
                      {context.manualContext.verification === 'technician_validated'
                        ? 'validado por t\u00e9cnico'
                        : 'no verificado'}
                    </p>
                  )}
                  {(context.manualContext?.affectDecisions ?? [])
                    .filter((decision) => decision.action === 'add')
                    .map((decision) => (
                      <div
                        key={decision.id}
                        className="mt-2 rounded-md border border-violet-200 bg-violet-50 p-2 text-sm"
                      >
                        <p>{decision.name}</p>
                        <p className="text-xs text-violet-800">Manual · {decision.reason}</p>
                      </div>
                    ))}
                </div>

                <details className="bg-background rounded-lg border p-4 group">
                  <summary className="text-sm font-semibold cursor-pointer outline-none">
                    Ver plano oficial de ordenación pormenorizada (PORD)
                  </summary>
                  <div className="mt-4 pt-4 border-t">
                    <PordPlanViewer
                      municipality={context.municipality || undefined}
                      instrument={context.instrument || undefined}
                      wmsLayer={context.municipalityCode === '15009' ? '_15009_NNSSPP_199606_AD_PORD_02CL_22221' : undefined}
                      parcelGeometry={context.parcelGeometry}
                      actionAreaGeometry={context.actionArea?.geometry}
                      classificationCode={context.classification?.code}
                      categoryCode={context.classification?.categoryCode}
                      affects={context.affects}
                    />
                  </div>
                </details>

              </>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
