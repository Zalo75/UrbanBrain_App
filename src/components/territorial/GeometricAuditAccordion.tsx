'use client';

import { Activity } from 'lucide-react';
import type { ClassificationCandidate } from '@/domain/territorial-resolver/types';

interface Props {
  totalParcelArea: number; // The official area from Catastro (or the base source)
  candidates: ClassificationCandidate[]; // All candidates found
}

export function GeometricAuditAccordion({ totalParcelArea, candidates }: Props) {
  // Extract official planning areas vs complement
  let planningArea = 0;
  let complementArea = 0;

  candidates.forEach(c => {
    if (c.kind === 'official_classification') {
      planningArea += c.parcelCoverage?.intersectionAreaSquareMetres ?? 0;
    } else {
      complementArea += c.parcelCoverage?.intersectionAreaSquareMetres ?? 0;
    }
  });

  const inspireArea = planningArea + complementArea;

  return (
    <details className="mt-6 border rounded-lg bg-zinc-50/50 dark:bg-zinc-950/20 group">
      <summary className="flex cursor-pointer items-center gap-2 p-3 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">
        <Activity className="h-4 w-4 text-slate-500" />
        Auditoría técnica de superficies
        <span className="ml-auto text-[10px] text-muted-foreground uppercase tracking-wider group-open:hidden">Desplegar</span>
        <span className="ml-auto text-[10px] text-muted-foreground uppercase tracking-wider hidden group-open:inline">Ocultar</span>
      </summary>
      
      <div className="p-4 pt-0 text-sm border-t mt-2">
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border p-3 bg-white dark:bg-slate-950 shadow-sm">
            <p className="text-xs text-muted-foreground mb-1">Superficie declarada</p>
            <p className="font-mono font-medium">{totalParcelArea.toLocaleString('es-ES', { maximumFractionDigits: 2 })} m²</p>
            <p className="text-[10px] text-muted-foreground mt-1 uppercase">Catastro Alfanumérico</p>
          </div>
          <div className="rounded-md border p-3 bg-white dark:bg-slate-950 shadow-sm">
            <p className="text-xs text-muted-foreground mb-1">Superficie geométrica total</p>
            <p className="font-mono font-medium">{inspireArea.toLocaleString('es-ES', { maximumFractionDigits: 2 })} m²</p>
            <p className="text-[10px] text-muted-foreground mt-1 uppercase">Catastro INSPIRE</p>
          </div>
          <div className="rounded-md border p-3 bg-white dark:bg-slate-950 shadow-sm border-indigo-200 dark:border-indigo-900/50">
            <p className="text-xs text-indigo-600/80 dark:text-indigo-400 mb-1">Planeamiento Oficial</p>
            <p className="font-mono font-medium text-indigo-950 dark:text-indigo-100">{planningArea.toLocaleString('es-ES', { maximumFractionDigits: 2 })} m²</p>
            <p className="text-[10px] text-indigo-500/70 mt-1 uppercase">Suma de recintos hallados</p>
          </div>
          <div className="rounded-md border p-3 bg-white dark:bg-slate-950 shadow-sm border-amber-200 dark:border-amber-900/50">
            <p className="text-xs text-amber-600/80 dark:text-amber-400 mb-1">Complemento Geométrico</p>
            <p className="font-mono font-medium text-amber-950 dark:text-amber-100">{complementArea.toLocaleString('es-ES', { maximumFractionDigits: 2 })} m²</p>
            <p className="text-[10px] text-amber-500/70 mt-1 uppercase">Brecha de cobertura</p>
          </div>
        </div>

        <div className="mt-4 p-3 rounded bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 text-xs text-blue-800 dark:text-blue-300">
          <p>La auditoría compara la geometría de la parcela frente a las capas del planeamiento.</p>
          <p className="mt-1 opacity-80">El desglose alfanumérico catastral por sub-parcelas no se muestra porque no figura en el contexto actual o no se ha descargado el XML de sub-parcelas. Para una comparativa completa, el expediente debería contar con el registro DGC.</p>
        </div>
      </div>
    </details>
  );
}
