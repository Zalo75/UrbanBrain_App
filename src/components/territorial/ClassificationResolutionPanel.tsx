'use client';

import { AlertTriangle, CheckCircle2, ExternalLink, Layers3, RotateCw } from 'lucide-react';

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

const sourceLabels = {
  catastro: 'Catastro',
  cartociudad: 'CartoCiudad',
  siotuga: 'SIOTUGA',
  ideg: 'Cartografía oficial de Galicia',
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
  instrument_traceability_pending:
    'La vinculación entre la capa cartográfica y el instrumento vigente todavía debe verificarse.',
  instrument_layer_mismatch:
    'La capa cartográfica consultada no coincide con el instrumento identificado como vigente.',
  source_disagreement: 'Las fuentes oficiales consultadas ofrecen resultados diferentes.',
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

      {resolution.candidates.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {resolution.candidates.map((candidate) => {
            const proposed = resolution.proposal?.candidateId === candidate.id;
            const selected = selectedCandidateId === candidate.id;
            return (
              <article key={candidate.id} className="rounded-md border bg-background p-3 text-foreground">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{candidate.classification.label}</p>
                  {proposed && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                      Propuesta de UrbanBrain · revisar
                    </span>
                  )}
                </div>
                <p className="mt-1 font-mono text-xs">
                  {candidate.classification.code}
                  {candidate.classification.categoryCode
                    ? ` · ${candidate.classification.categoryCode}`
                    : ''}
                </p>
                {candidate.areas.length > 0 && (
                  <p className="mt-2 text-xs">
                    Ámbito: {candidate.areas.map((area) => area.name).join(', ')}
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  {sourceLabels[candidate.source]} · {confidenceLabel(candidate.confidence)}
                </p>
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
      )}

      {resolution.proposal && (
        <p className="mt-3 text-xs">
          <span className="font-semibold">Motivo de la propuesta:</span>{' '}
          {resolution.proposal.explanation}
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
                      .map((assertion) => `${sourceLabels[assertion.source as keyof typeof sourceLabels] ?? assertion.source}: ${assertion.value}`)
                      .join(' · ')}
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
            {resolution.sourceChecks.map((check, index) => (
              <li key={`${check.source}-${check.checkedAt}-${index}`}>
                {sourceLabels[check.source]}: {check.message}
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
