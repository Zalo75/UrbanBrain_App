'use client';

import type { ClassificationCandidate } from '@/domain/territorial-resolver/types';

interface Props {
  candidates: ClassificationCandidate[];
  onSelect: (candidateId: string) => void;
}

export function AvailableZonesSummary({ candidates, onSelect }: Props) {
  if (candidates.length === 0) return null;

  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Otras zonas disponibles</h4>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {candidates.map(candidate => {
          const isOfficial = candidate.kind === 'official_classification';
          const title = isOfficial && candidate.classification.categoryLabel
            ? `${candidate.classification.label} · ${candidate.classification.categoryLabel}`
            : isOfficial ? candidate.classification.label : 'Zona sin cobertura';

          const area = candidate.parcelCoverage?.intersectionAreaSquareMetres ?? 0;
          const percentage = candidate.parcelCoverage?.parcelPercentage ?? 0;

          return (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onSelect(candidate.id)}
              className="text-left flex flex-col p-3 rounded-md border bg-white dark:bg-slate-950 hover:border-slate-400 dark:hover:border-slate-600 transition-colors shadow-sm"
            >
              <span className="text-xs font-medium text-foreground truncate w-full" title={title}>
                {title}
              </span>
              <span className="mt-1 text-[11px] text-muted-foreground flex items-center justify-between w-full">
                <span>{area.toLocaleString('es-ES', { maximumFractionDigits: 2 })} m² ({percentage.toLocaleString('es-ES', { maximumFractionDigits: 2 })}%)</span>
                {!isOfficial && (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">Complementaria</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
