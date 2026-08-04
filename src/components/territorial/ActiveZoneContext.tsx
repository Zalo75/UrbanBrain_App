'use client';

import { Database, FileText, Sparkles, ArrowRight, ArrowDown, CheckCircle2 } from 'lucide-react';
import type { ClassificationCandidate } from '@/domain/territorial-resolver/types';

interface Props {
  candidate: ClassificationCandidate;
}

const SOURCES = {
  catastro: 'Catastro',
  cartociudad: 'CartoCiudad',
  siotuga: 'SIOTUGA',
  ideg: 'Cartografía oficial de Galicia',
  derived_geometry_complement: 'Zona sin cobertura vectorial de clasificación',
} as const;

export function ActiveZoneContext({ candidate }: Props) {
  const isOfficial = candidate.kind === 'official_classification';
  const displayTitle = isOfficial && candidate.classification.categoryLabel
    ? `${candidate.classification.label} · ${candidate.classification.categoryLabel}`
    : isOfficial ? candidate.classification.label : 'Zona sin cobertura vectorial de clasificación';

  return (
    <div className="rounded-md border bg-background text-foreground flex flex-col">
      <div className="p-4 border-b bg-muted/20">
        <h3 className="text-sm font-semibold">{displayTitle}</h3>
        {isOfficial && (
          <p className="mt-1 text-xs opacity-80 font-mono">
            {candidate.classification.code}
            {candidate.classification.categoryCode ? ` · ${candidate.classification.categoryCode}` : ''}
          </p>
        )}
        {candidate.areas.length > 0 && (
          <p className="mt-2 text-xs">
            Ámbito: <span className="font-medium">{candidate.areas.map(a => a.name).join(', ')}</span>
          </p>
        )}
        {candidate.parcelCoverage && (
          <p className="mt-2 text-xs text-muted-foreground">
            Superficie operativa: <span className="font-medium text-foreground">{candidate.parcelCoverage.intersectionAreaSquareMetres.toLocaleString('es-ES', { maximumFractionDigits: 2 })} m²</span> ({candidate.parcelCoverage.parcelPercentage.toLocaleString('es-ES', { maximumFractionDigits: 2 })}%)
          </p>
        )}
      </div>

      <div className="p-4 bg-slate-50 dark:bg-slate-900/50">
        <p className="font-semibold text-xs text-slate-700 dark:text-slate-300 mb-4 uppercase tracking-wide">
          Trazabilidad de origen
        </p>
        
        {!isOfficial ? (
          <div className="text-xs text-muted-foreground bg-white dark:bg-slate-950 p-4 rounded-md border shadow-sm">
            <p className="font-medium text-foreground mb-1">Origen geométrico derivado</p>
            <p>Esta zona se ha calculado por diferencia entre la superficie de la parcela y los recintos vectoriales encontrados.</p>
            <p className="mt-2">Fuente consultada: {SOURCES[candidate.source as keyof typeof SOURCES] ?? candidate.source}</p>
            <p className="mt-1">Superficie: {candidate.parcelCoverage?.intersectionAreaSquareMetres.toLocaleString('es-ES', { maximumFractionDigits: 2 })} m² ({candidate.parcelCoverage?.parcelPercentage.toLocaleString('es-ES', { maximumFractionDigits: 2 })}%)</p>
            <p className="mt-2 font-medium text-amber-700 dark:text-amber-400">Clasificación urbanística no determinada automáticamente.</p>
          </div>
        ) : (
          <div className="overflow-x-auto bg-white dark:bg-slate-950 p-4 rounded-md border shadow-sm">
            <div className="flex flex-col md:flex-row items-center md:items-stretch justify-between gap-4 md:gap-2 min-w-max md:min-w-0">
              <div className="flex flex-col items-center text-center w-40 shrink-0">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700 mb-2 shadow-sm">
                  <Database className="w-4 h-4" />
                </div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Origen</p>
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-200 mt-1">{candidate.source === 'siotuga' ? 'SIOTUGA' : candidate.source === 'ideg' ? 'IDEG' : candidate.source}</p>
              </div>

              <div className="hidden md:flex flex-col justify-center text-slate-300 dark:text-slate-700">
                <ArrowRight className="w-4 h-4" />
              </div>
              <div className="flex md:hidden justify-center text-slate-300 dark:text-slate-700 py-1">
                <ArrowDown className="w-4 h-4" />
              </div>

              <div className="flex flex-col items-center text-center w-40 shrink-0">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400 border border-blue-100 dark:border-blue-900/60 mb-2 shadow-sm">
                  <FileText className="w-4 h-4" />
                </div>
                <p className="text-[10px] font-bold text-blue-500/80 dark:text-blue-400/80 uppercase tracking-wide">Código recibido</p>
                <p className="text-xs font-bold text-blue-900 dark:text-blue-100 mt-1 font-mono">
                  {candidate.officialAttributes?.[0]?.classificationCode ?? 'N/A'}
                  {candidate.officialAttributes?.[0]?.categoryCode ? ` (${candidate.officialAttributes[0].categoryCode})` : ''}
                </p>
              </div>

              <div className="hidden md:flex flex-col justify-center text-slate-300 dark:text-slate-700">
                <ArrowRight className="w-4 h-4" />
              </div>
              <div className="flex md:hidden justify-center text-slate-300 dark:text-slate-700 py-1">
                <ArrowDown className="w-4 h-4" />
              </div>

              <div className="flex flex-col items-center text-center w-48 shrink-0">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/60 mb-2 shadow-sm relative">
                  <Sparkles className="w-4 h-4" />
                  {candidate.normalizationStatus === 'mapped' && (
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-indigo-600 text-white rounded-full flex items-center justify-center border-2 border-white dark:border-slate-950">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                    </div>
                  )}
                </div>
                <p className="text-[10px] font-bold text-indigo-500/80 dark:text-indigo-400/80 uppercase tracking-wide">Valor Operativo</p>
                <span className="font-semibold text-xs text-foreground truncate mt-1">
                  {candidate.classification.label}
                  {candidate.classification.categoryLabel ? ` · ${candidate.classification.categoryLabel}` : ''}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
