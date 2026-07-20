'use client';

import { useActionState, useEffect, useState } from 'react';
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

export function TerritorialContextPanel({ expedienteId, initialInput, context }: Props) {
  const router = useRouter();
  const action = resolveTerritorialContextAction.bind(null, expedienteId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [router, state.status]);

  const status = context ? statusCopy[context.status] : statusCopy.undetermined;
  const affectsFullyChecked = context?.sourceChecks.some(
    (check) => check.source === 'ideg' && check.status === 'available'
  );

  return (
    <details className="group border-b bg-zinc-50/70 dark:bg-zinc-950/30" open={!context}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <MapPinned className="text-muted-foreground h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">Ubicación y contexto territorial</h2>
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
                    <p className="text-muted-foreground text-xs">Clasificación / categoría</p>
                    <p className="mt-1 text-sm font-medium">
                      {context.classification?.label ?? 'No determinada'}
                    </p>
                    {context.classification?.categoryCode && (
                      <p className="mt-1 font-mono text-xs">
                        {context.classification.code} · {context.classification.categoryCode}
                      </p>
                    )}
                  </div>
                  <div className="bg-background rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">Planeamiento</p>
                    <p className="mt-1 text-sm font-medium">
                      {context.instrument ?? 'No determinado'}
                    </p>
                    {context.areas.length > 0 && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        Ámbito: {context.areas.join(', ')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="bg-background rounded-lg border p-4">
                  <h3 className="text-sm font-semibold">Afecciones positivas detectadas</h3>
                  {context.affects.length ? (
                    <ul className="mt-2 space-y-2 text-sm">
                      {context.affects.map((affect, index) => (
                        <li
                          key={`${affect.category}-${affect.name}-${index}`}
                          className="flex gap-2"
                        >
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <span>{affect.name}</span>
                        </li>
                      ))}
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
                </div>

                {!context.canAnswerConcreteParameters && (
                  <p className="text-muted-foreground text-xs">
                    UrbanBrain se abstendrá de dar parámetros urbanísticos concretos mientras el
                    régimen aplicable no esté determinado inequívocamente.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
