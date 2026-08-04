'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Check, Copy, Map } from 'lucide-react';

import type {
  ClassificationCandidate,
  ParcelGeometry,
  TerritorialCoordinates,
} from '@/domain/territorial-resolver/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { BASE_MAP_LAYERS, type BaseMapLayerId } from './baseMapLayers';

const LeafletParcelMap = dynamic(() => import('./LeafletParcelMap'), {
  ssr: false,
  loading: () => (
    <div className="bg-muted/40 flex h-[320px] items-center justify-center rounded-md sm:h-[380px]">
      <p className="text-muted-foreground text-sm">Cargando visor cartográfico…</p>
    </div>
  ),
});

interface Props {
  geometry?: ParcelGeometry;
  coordinates?: TerritorialCoordinates;
  candidates?: ClassificationCandidate[];
  selectedCandidateId?: string;
  onCandidateSelect?: (candidateId: string) => void;
}

export function ParcelMap({ geometry, coordinates, candidates, selectedCandidateId, onCandidateSelect }: Props) {
  const [baseLayerId, setBaseLayerId] = useState<BaseMapLayerId>('catastro');
  const [copyResult, setCopyResult] = useState<{
    text: string;
    status: 'copied' | 'error';
  }>();
  const coordinateText = coordinates
    ? `${coordinates.lat.toFixed(6)}, ${coordinates.lng.toFixed(6)}`
    : undefined;
  const copyState =
    copyResult && copyResult.text === coordinateText ? copyResult.status : 'idle';

  async function copyCoordinates() {
    if (!coordinateText) return;
    try {
      await navigator.clipboard.writeText(coordinateText);
      setCopyResult({ text: coordinateText, status: 'copied' });
    } catch {
      setCopyResult({ text: coordinateText, status: 'error' });
    }
  }

  return (
    <section className="bg-background space-y-4 rounded-lg border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Map className="h-4 w-4" /> Visor cartográfico
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Localización de la parcela sobre la cartografía seleccionada.
          </p>
        </div>
        <div className="grid w-full gap-1.5 sm:w-48">
          <Label htmlFor="parcel-map-base-layer" className="text-xs">
            Capa base
          </Label>
          <select
            id="parcel-map-base-layer"
            value={baseLayerId}
            onChange={(event) => setBaseLayerId(event.target.value as BaseMapLayerId)}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-sm"
          >
            {BASE_MAP_LAYERS.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!geometry && !coordinates ? (
        <div className="text-muted-foreground flex h-[220px] items-center justify-center rounded-md border border-dashed p-6 text-center text-sm">
          No hay una ubicación disponible para mostrar en el visor.
        </div>
      ) : (
        <>
          <LeafletParcelMap
            geometry={geometry}
            coordinates={coordinates}
            baseLayerId={baseLayerId}
          />
          {!geometry && coordinates && (
            <p role="status" className="text-xs text-amber-800 dark:text-amber-300">
              Ubicación aproximada: no se dispone de la geometría oficial de la parcela.
            </p>
          )}
        </>
      )}


      {((candidates ?? []).filter((candidate: import('@/domain/territorial-resolver/types').ClassificationCandidate) => candidate.parcelCoverage?.intersectionGeometry).length ?? 0) > 0 && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-medium">Zonas territoriales detectadas</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(candidates ?? [])
              .filter((c: import('@/domain/territorial-resolver/types').ClassificationCandidate) => c.parcelCoverage?.intersectionGeometry)
              .map((candidate: import('@/domain/territorial-resolver/types').ClassificationCandidate) => {
                const selected = candidate.id === selectedCandidateId;
                const isOfficial = candidate.kind === 'official_classification';
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => onCandidateSelect?.(candidate.id)}
                    aria-pressed={selected}
                    className={`rounded-md border p-3 text-left text-xs transition-colors ${
                      selected
                        ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-200 dark:bg-orange-950/30'
                        : 'hover:border-orange-300'
                    }`}
                  >
                    <span className="block font-semibold">
                      {isOfficial
                        ? (candidate.classification.categoryLabel ?? candidate.classification.label)
                        : 'Zona sin cobertura vectorial de clasificación'}
                    </span>
                    <span className="text-muted-foreground mt-1 block font-mono">
                      {isOfficial && (
                        <>
                          {candidate.classification.code}
                          {candidate.classification.categoryCode ? ` / ${candidate.classification.categoryCode}` : ''}
                        </>
                      )}
                    </span>
                    <span className="mt-1 block">
                      {candidate.parcelCoverage?.intersectionAreaSquareMetres.toLocaleString('es-ES', {
                        maximumFractionDigits: 2,
                      })}{' '}
                      m² · {candidate.parcelCoverage?.parcelPercentage.toLocaleString('es-ES', {
                        maximumFractionDigits: 2,
                      })}{' '}
                      %
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}


<div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div>
            <dt className="text-muted-foreground">Latitud</dt>
            <dd className="font-mono">{coordinates ? coordinates.lat.toFixed(6) : 'No disponible'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Longitud</dt>
            <dd className="font-mono">{coordinates ? coordinates.lng.toFixed(6) : 'No disponible'}</dd>
          </div>
        </dl>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!coordinateText}
          onClick={copyCoordinates}
          className="w-full sm:w-auto"
        >
          {copyState === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copyState === 'copied' ? 'Coordenadas copiadas' : 'Copiar coordenadas'}
        </Button>
      </div>
      {copyState === 'error' && (
        <p role="alert" className="text-destructive text-xs">
          No se pudieron copiar las coordenadas. Puede seleccionarlas manualmente.
        </p>
      )}
    </section>
  );
}
