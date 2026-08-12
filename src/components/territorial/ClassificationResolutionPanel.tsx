'use client';

import { AlertTriangle, CheckCircle2, ExternalLink, Layers3, RotateCw, Database, FileText, Sparkles, Activity, ArrowRight, ArrowDown, Map as MapIcon } from 'lucide-react';

import type {
  ClassificationCandidate,
  ClassificationResolution,
  ClassificationReviewReason,
} from '@/domain/territorial-resolver/types';

const statusCopy = {
  clear: {
    title: 'Clasificación oficial coherente',
    detail: 'Las fuentes oficiales consultadas permiten identificar una clasificación aplicable.',
    icon: CheckCircle2,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  },
  probable: {
    title: 'Clasificación probable con evidencia oficial',
    detail:
      'Existe una única clasificación utilizable. Puede emplearse indicando la comprobación documental pendiente.',
    icon: AlertTriangle,
    className: 'border-amber-200 bg-amber-50 text-amber-950',
  },
  multiple_intersections: {
    title: 'La parcela intersecta varios ámbitos urbanísticos',
    detail: 'Se conservan todas las clasificaciones detectadas. Seleccione el valor operativo después de revisar los ámbitos.',
    icon: Layers3,
    className: 'border-sky-200 bg-sky-50 text-sky-950',
  },
  review_required: {
    title: 'La clasificación requiere revisión profesional',
    detail: 'Existe evidencia oficial útil, pero no permite confirmar una única interpretación sin revisar las discrepancias indicadas.',
    icon: AlertTriangle,
    className: 'border-amber-200 bg-amber-50 text-amber-950',
  },
  not_available: {
    title: 'Las fuentes oficiales no ofrecen una clasificación suficiente',
    detail: 'Las consultas disponibles no permiten determinarla automáticamente. Puede consultar los recursos oficiales y seleccionar un valor manual.',
    icon: Layers3,
    className: 'border-zinc-200 bg-zinc-50 text-zinc-950',
  },
  source_unavailable: {
    title: 'No se pudo completar la consulta oficial',
    detail: 'Una fuente necesaria no respondió correctamente. Puede reintentar o continuar dejando la clasificación pendiente.',
    icon: RotateCw,
    className: 'border-violet-200 bg-violet-50 text-violet-950',
  },
} as const;

const SOURCES = {
  catastro: 'Catastro',
  cartociudad: 'CartoCiudad',
  siotuga: 'SIOTUGA',
  ideg: 'Cartografía oficial de Galicia',
  derived_geometry_complement: 'Zona sin cobertura vectorial de clasificación',
} as const;

const nextActionCopy = {
  auto_accept: 'La selección automática queda disponible y puede modificarla manualmente.',
  manual_selection: 'Revise los ámbitos y seleccione el valor operativo para el expediente.',
  review_official_sources: 'Consulte las evidencias enlazadas y documente el criterio de su selección.',
  retry_source: 'Reintente la consulta oficial antes de utilizar este dato como confirmado.',
} as const;

const reviewReasonCopy: Record<ClassificationReviewReason, string> = {
  point_geometry_mismatch:
    'El punto representativo y la geometría completa de la parcela no producen el mismo resultado.',
  partial_parcel_coverage:
    'La cartografía estructurada consultada sólo clasifica una parte de la superficie parcelaria.',
  planning_update_scope_pending:
    'La parcela puede estar afectada por una ordenación posterior que la capa vectorial consultada todavía no incorpora.',
  instrument_traceability_pending:
    'La vinculación entre la capa cartográfica y el instrumento vigente todavía debe verificarse.',
  instrument_layer_mismatch:
    'La capa cartográfica consultada no coincide con el instrumento identificado como vigente.',
  source_disagreement: 'Las fuentes oficiales consultadas ofrecen resultados diferentes.',
  intra_source_disagreement: 'Una misma fuente oficial devuelve múltiples clasificaciones o categorías.',
  incomplete_source_check: 'No se pudo completar una comprobación necesaria en una fuente oficial.',
  ambiguous_code_mapping:
    'El código oficial no tiene una equivalencia inequívoca con las opciones operativas del expediente.',
  insufficient_geometry:
    'La geometría disponible no permite determinar la clasificación para toda la parcela.',
};

function confidenceLabel(confidence: ClassificationCandidate['confidence']) {
  return confidence === 'high'
    ? 'Confianza alta'
    : confidence === 'medium'
      ? 'Confianza media'
      : 'Confianza baja';
}

interface Props {
  resolution: ClassificationResolution;
  selectedCandidateId?: string;
  onSelectCandidate?: (candidate: ClassificationCandidate) => void;
}

export function ClassificationResolutionPanel({
  resolution,
  selectedCandidateId,
  onSelectCandidate,
}: Props) {
  const copy = statusCopy[resolution.status];
  const Icon = copy.icon;
  return (
    <section className={`rounded-lg border p-4 ${copy.className}`} aria-live="polite">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <h3 className="text-sm font-semibold">{copy.title}</h3>
          <p className="mt-1 text-xs">{copy.detail}</p>
        </div>
      </div>

      {resolution.candidates.length > 0 && (() => {
        const maxIntersectionArea = Math.max(
          0,
          ...resolution.candidates.map(
            (c) => c.parcelCoverage?.intersectionAreaSquareMetres ?? 0
          )
        );
        const hasMultiple = resolution.candidates.length > 1;
        return (
          <div className="mt-4 flex flex-col gap-6">
            {resolution.candidates.map((candidate) => {
              const proposed = resolution.proposal?.candidateId === candidate.id;
              const selected = selectedCandidateId === candidate.id;
              const area = candidate.parcelCoverage?.intersectionAreaSquareMetres ?? 0;
              const isPredominant = hasMultiple && maxIntersectionArea > 0 && area === maxIntersectionArea;
              const isSecondary = hasMultiple && !isPredominant && area > 0;
              const isOfficial = candidate.kind === 'official_classification';
              const displayTitle = isOfficial && candidate.classification.categoryLabel
                ? `${candidate.classification.label} · ${candidate.classification.categoryLabel}`
                : isOfficial ? candidate.classification.label : 'Zona sin cobertura vectorial de clasificación';

              return (
                <article key={candidate.id} className="rounded-md border bg-background p-3 text-foreground">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{displayTitle}</p>
                    <div className="flex flex-wrap gap-1">
                      {isPredominant && (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-900">
                          Predominante
                        </span>
                      )}
                      {isSecondary && (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                          Intersección secundaria
                        </span>
                      )}
                      {proposed && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                          Propuesta de UrbanBrain · revisar
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-xs opacity-80">
                    {isOfficial && (
                      <>
                        Código clasificación: {candidate.classification.code}
                        {candidate.classification.categoryCode
                          ? ` · Código categoría: ${candidate.classification.categoryCode}`
                          : ''}
                      </>
                    )}
                  </div>
                  {candidate.areas.length > 0 && (
                    <p className="mt-2 text-xs">
                      Ámbito: {candidate.areas.map((areaItem) => areaItem.name).join(', ')}
                    </p>
                  )}
                  {candidate.parcelCoverage && (
                    <p className="mt-2 text-xs">
                      Superficie intersectada:{' '}
                      {candidate.parcelCoverage.intersectionAreaSquareMetres.toLocaleString('es-ES', {
                        maximumFractionDigits: 2,
                      })}{' '}
                      m² ({candidate.parcelCoverage.parcelPercentage.toLocaleString('es-ES', {
                        maximumFractionDigits: 2,
                      })}{' '}
                      % de la parcela)
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {SOURCES[candidate.source as keyof typeof SOURCES] ?? candidate.source} · {confidenceLabel(candidate.confidence)}
                  </p>

                  <div className="mt-4 rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col">
                    <div className="border-b bg-muted/50 px-4 py-3">
                      <p className="font-semibold text-sm">
                        Trazabilidad de la clasificación
                      </p>
                    </div>

                    {/* PIPELINE VISUAL */}
                    <div className="p-6 overflow-x-auto bg-white dark:bg-slate-950">
                      <div className="flex flex-col md:flex-row items-center md:items-stretch justify-between gap-4 md:gap-2 min-w-max md:min-w-0">
                        {/* Step 1: Origen */}
                        <div className="flex flex-col items-center text-center w-40 shrink-0">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700 mb-3 shadow-sm">
                            <Database className="w-5 h-5" />
                          </div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Origen</p>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-200 mt-1">{candidate.source === 'siotuga' ? 'SIOTUGA' : candidate.source === 'ideg' ? 'IDEG' : candidate.source}</p>
                        </div>

                        {/* Arrow */}
                        <div className="hidden md:flex flex-col justify-center text-slate-300 dark:text-slate-700">
                          <ArrowRight className="w-5 h-5" />
                        </div>
                        <div className="flex md:hidden justify-center text-slate-300 dark:text-slate-700 py-1">
                          <ArrowDown className="w-5 h-5" />
                        </div>

                        {/* Step 2: Recibido */}
                        <div className="flex flex-col items-center text-center w-40 shrink-0">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400 border border-blue-100 dark:border-blue-900/60 mb-3 shadow-sm">
                            <FileText className="w-5 h-5" />
                          </div>
                          <p className="text-[10px] font-bold text-blue-500/80 dark:text-blue-400/80 uppercase tracking-wide">Código recibido</p>
                          <p className="text-sm font-bold text-blue-900 dark:text-blue-100 mt-1 font-mono">
                            {candidate.kind === 'official_classification' ? (candidate.officialAttributes?.[0]?.classificationCode ?? 'N/A') : 'N/A'}
                            {candidate.kind === 'official_classification' && candidate.officialAttributes?.[0]?.categoryCode ? ` (${candidate.officialAttributes[0].categoryCode})` : ''}
                          </p>
                        </div>

                        {/* Arrow */}
                        <div className="hidden md:flex flex-col justify-center text-slate-300 dark:text-slate-700">
                          <ArrowRight className="w-5 h-5" />
                        </div>
                        <div className="flex md:hidden justify-center text-slate-300 dark:text-slate-700 py-1">
                          <ArrowDown className="w-5 h-5" />
                        </div>

                        {/* Step 3: Normalización */}
                        <div className="flex flex-col items-center text-center w-48 shrink-0">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/60 mb-3 shadow-sm relative">
                            <Sparkles className="w-5 h-5" />
                            {candidate.normalizationStatus === 'mapped' && (
                              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center border-2 border-white dark:border-slate-950">
                                <CheckCircle2 className="w-3 h-3" />
                              </div>
                            )}
                          </div>
                          <p className="text-[10px] font-bold text-indigo-500/80 dark:text-indigo-400/80 uppercase tracking-wide">Normalización UrbanBrain</p>
                          <span className="font-semibold text-foreground truncate">
                            {isOfficial ? candidate.classification.label : 'Sin clasificación oficial'}
                            {isOfficial && candidate.classification.categoryLabel ? ` · ${candidate.classification.categoryLabel}` : ''}
                          </span>
                        </div>

                        {/* Arrow */}
                        <div className="hidden md:flex flex-col justify-center text-slate-300 dark:text-slate-700">
                          <ArrowRight className="w-5 h-5" />
                        </div>
                        <div className="flex md:hidden justify-center text-slate-300 dark:text-slate-700 py-1">
                          <ArrowDown className="w-5 h-5" />
                        </div>

                        {/* Step 4: Espacial */}
                        <div className="flex flex-col items-center text-center w-40 shrink-0">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/60 mb-3 shadow-sm">
                            <MapIcon className="w-5 h-5" />
                          </div>
                          <p className="text-[10px] font-bold text-emerald-600/80 dark:text-emerald-400/80 uppercase tracking-wide">Validación espacial</p>
                          <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100 mt-1">
                            {candidate.parcelCoverage ? (
                              <>
                                {candidate.parcelCoverage.intersectionAreaSquareMetres.toLocaleString('es-ES', { maximumFractionDigits: 2 })} m²
                                <span className="text-emerald-700/70 dark:text-emerald-300/70 font-normal ml-1">· {candidate.parcelCoverage.parcelPercentage.toLocaleString('es-ES', { maximumFractionDigits: 0 })} %</span>
                              </>
                            ) : (
                              'Sin cruce'
                            )}
                          </p>
                        </div>

                        {/* Arrow */}
                        <div className="hidden md:flex flex-col justify-center text-emerald-300 dark:text-emerald-700/50">
                          <ArrowRight className="w-5 h-5" />
                        </div>
                        <div className="flex md:hidden justify-center text-emerald-300 dark:text-emerald-700/50 py-1">
                          <ArrowDown className="w-5 h-5" />
                        </div>

                        {/* Step 5: Resultado */}
                        <div className="flex flex-col items-center text-center w-40 shrink-0">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-600 text-white shadow-md mb-3 ring-4 ring-emerald-50 dark:ring-emerald-950">
                            <CheckCircle2 className="w-6 h-6" />
                          </div>
                          <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Resultado final</p>
                          <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100 mt-1">
                            Clasificación aceptada
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* DETALLE TÉCNICO */}
                    <div className="border-t bg-slate-50/50 dark:bg-slate-900/30 p-6">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-8 divide-y md:divide-y-0 md:divide-x divide-slate-200/60 dark:divide-slate-800">
                        {/* 1. Origen */}
                        <div className="pt-4 md:pt-0">
                          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Origen de datos</h4>
                          <dl className="space-y-3 text-sm">
                            <div>
                              <dt className="text-slate-400 text-xs mb-0.5">Fuente WFS</dt>
                              <dd className="font-mono text-[11px] text-slate-700 dark:text-slate-300 break-words">{candidate.sourceKey ?? 'No disponible'}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-400 text-xs mb-0.5">Adaptador</dt>
                              <dd className="font-mono text-[11px] text-slate-700 dark:text-slate-300 break-words whitespace-pre-wrap">
                                {candidate.source === 'siotuga' ? 'SiotugaClassificationAdapter' : candidate.source === 'ideg' ? 'IdegClassificationAdapter' : candidate.source}
                              </dd>
                            </div>
                            {candidate.kind === 'official_classification' && candidate.officialAttributes && candidate.officialAttributes.length > 0 && (
                              <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800">
                                <dt className="text-slate-400 text-xs mb-1">Código original del planeamiento</dt>
                                <dd className="font-mono text-xs text-slate-600 dark:text-slate-400">
                                  {[...new Set(candidate.officialAttributes.map(a => a.classificationCode).filter(Boolean))].join(', ') || 'ND'}
                                  {[...new Set(candidate.officialAttributes.map(a => a.categoryCode).filter(Boolean))].join(', ') ? ` (${[...new Set(candidate.officialAttributes.map(a => a.categoryCode).filter(Boolean))].join(', ')})` : ''}
                                </dd>
                              </div>
                            )}
                          </dl>
                        </div>

                        {/* 2. Oficial */}
                        <div className="pt-4 md:pt-0 md:pl-8">
                          <h4 className="text-[11px] font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400 mb-3">Información oficial</h4>
                          <dl className="space-y-3 text-sm">
                            <div>
                              <dt className="text-slate-400 text-xs mb-0.5">Código oficial</dt>
                              <dd className="font-mono text-[11px] text-blue-900 dark:text-blue-100 font-medium break-words">
                                {candidate.kind === 'official_classification' ? (candidate.officialAttributes?.[0]?.classificationCode ?? 'No disponible') : 'No disponible'}
                                {candidate.kind === 'official_classification' && candidate.officialAttributes?.[0]?.categoryCode ? ` (${candidate.officialAttributes[0].categoryCode})` : ''}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-400 text-xs mb-0.5">Descripción oficial</dt>
                              <dd className="text-[13px] text-slate-700 dark:text-slate-300">
                                {candidate.kind === 'official_classification' ? (candidate.officialAttributes?.[0]?.denomination ?? candidate.officialAttributes?.[0]?.use ?? 'No disponible') : 'No disponible'}
                              </dd>
                            </div>
                          </dl>
                        </div>

                        {/* 3. UrbanBrain */}
                        <div className="pt-4 md:pt-0 md:pl-8">
                          <h4 className="text-[11px] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400 mb-3">Interpretación UrbanBrain</h4>
                          <dl className="space-y-3 text-sm">
                            <div>
                              <dt className="text-slate-400 text-xs mb-0.5">Resultado normalizado</dt>
                              <dd className="font-mono text-[11px] text-indigo-900 dark:text-indigo-100 font-medium break-words">
                                {isOfficial ? (
                                  <>
                                    {candidate.classification.code}
                                    {candidate.classification.categoryCode ? ` (${candidate.classification.categoryCode})` : ''}
                                  </>
                                ) : (
                                  'ND'
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-400 text-xs mb-0.5">Regla aplicada</dt>
                              <dd className="text-[13px] text-slate-700 dark:text-slate-300">{candidate.normalizationStatus === 'mapped' ? 'Mapeo a dominio base' : 'Sin mapeo disponible'}</dd>
                            </div>
                          </dl>
                        </div>

                        {/* 4. Calidad */}
                        <div className="pt-4 md:pt-0 md:pl-8">
                          <h4 className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-500 mb-3">Calidad</h4>
                          <dl className="space-y-3 text-sm">
                            <div>
                              <dt className="text-slate-400 text-xs mb-0.5">Confianza</dt>
                              <dd className="text-[13px] text-slate-700 dark:text-slate-300 font-medium">{confidenceLabel(candidate.confidence)}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-400 text-xs mb-0.5">Fallback</dt>
                              <dd className="text-[13px] text-slate-700 dark:text-slate-300">
                                {resolution.sourceChecks.some(c => c.source === 'siotuga' && c.status !== 'available' && c.status !== 'partial') && candidate.source !== 'siotuga'
                                  ? `Activado (${resolution.sourceChecks.find(c => c.source === 'siotuga')?.status})`
                                  : 'No utilizado'}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                    </div>
                  </div>

                  {onSelectCandidate && (
                    <button
                      type="button"
                      className="mt-3 text-xs font-medium text-primary hover:underline"
                      onClick={() => onSelectCandidate(candidate)}
                    >
                      {selected ? 'Seleccionada para el expediente' : 'Usar como selección manual'}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        );
      })()}

      {resolution.proposal && (
        <p className="mt-3 text-xs">
          <span className="font-semibold">Motivo de la propuesta:</span>{' '}
          {resolution.proposal.explanation}
        </p>
      )}

      {resolution.automaticSelection?.reason && (
        <p className="mt-3 text-xs">
          <span className="font-semibold">Motivo de la selección:</span>{' '}
          {resolution.automaticSelection.reason}
          {resolution.automaticSelection.primarySource
            ? ` Fuente principal: ${resolution.automaticSelection.primarySource}.`
            : ''}
          {(resolution.automaticSelection.corroboratingSources?.length ?? 0) > 0
            ? ` Fuentes corroboradoras: ${resolution.automaticSelection.corroboratingSources?.join(', ')}.`
            : ''}
        </p>
      )}

      {resolution.finalSelection?.origin === 'manual' && (
        <p className="mt-3 text-xs">
          <span className="font-semibold">Selección operativa manual:</span>{' '}
          {resolution.finalSelection.reason ?? 'Registrada por un técnico.'}
        </p>
      )}

      {resolution.reviewReasons.length > 0 && (
        <div className="mt-4 rounded-md border border-current/20 bg-background/70 p-3 text-foreground">
          <h4 className="text-xs font-semibold">Motivos de revisión</h4>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
            {resolution.reviewReasons.map((reason) => (
              <li key={reason}>{reviewReasonCopy[reason]}</li>
            ))}
          </ul>
        </div>
      )}

      {resolution.discrepancies.length > 0 && (
        <div className="mt-4 rounded-md border border-current/20 bg-background/70 p-3 text-foreground">
          <h4 className="text-xs font-semibold">Aspectos que requieren comprobación</h4>
          <ul className="mt-2 space-y-2 text-xs">
            {resolution.discrepancies.map((discrepancy, index) => (
              <li key={`${discrepancy.reason}-${index}`}>
                {discrepancy.explanation}
                {discrepancy.assertions.length > 0 && (
                  <span className="mt-1 block text-muted-foreground">
                    {discrepancy.assertions
                      .map((assertion) => `${SOURCES[assertion.source as keyof typeof SOURCES] ?? assertion.source}: ${assertion.value}`)
                      .join(' vs ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {resolution.sourceChecks.length > 0 && (
        <div className="mt-4 text-xs">
          <p className="font-semibold">Fuentes consultadas</p>
          <ul className="mt-1 space-y-1">
            {resolution.sourceChecks.map((check, i) => (
              <li key={i}>
                {SOURCES[check.source as keyof typeof SOURCES] ?? check.source}: {check.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {resolution.officialLinks.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          {resolution.officialLinks.map((link) => (
            <a
              key={`${link.kind}-${link.url}`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              {link.label} <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs font-medium">Siguiente acción: {nextActionCopy[resolution.nextAction]}</p>
    </section>
  );
}
