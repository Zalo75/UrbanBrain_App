'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { projectParcelGeometryToRaster } from './parcelPixelProjection';

export function HasSessionView({ expedienteId, expedienteName, hasEligibility, parcelGeometry, cadastralReference, cartography, initialAlignment, persistAlignment, onClose }: {
  expedienteId?: string;
  expedienteName: string;
  hasEligibility: any;
  parcelGeometry: any;
  cadastralReference?: string;
  cartography?: { inputs: Array<{ kind: 'historical' | 'modern'; src: string; width: number; height: number; provenance: any }>; limitations: string[] };
  initialAlignment?: { transform: any; historicalViewId: string; modernViewId: string } | null;
  persistAlignment?: (input: any) => Promise<any>;
  onClose?: () => void;
}) {
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [srcdoc, setSrcdoc] = useState<string>('');

  useEffect(() => {
    const historical = cartography?.inputs.find(input => input.kind === 'historical');
    const modern = cartography?.inputs.find(input => input.kind === 'modern');
    const modernBbox = modern?.provenance?.bbox;
    const modernWidth = modern?.width || 0;
    const modernHeight = modern?.height || 0;
    const rings = modernBbox && parcelGeometry?.crs === 'EPSG:4326'
      ? projectParcelGeometryToRaster(parcelGeometry, modernBbox, modernWidth, modernHeight) || []
      : [];
    const parcelId = cadastralReference || 'Identificador catastral no disponible';
    const quote = (value: unknown) => JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
    fetch('/has-v1-template.html').then(res => res.text()).then(html => {
      const doc = html
        .replace(/<strong>8084401NH6388S<\/strong>/g, `<strong>${parcelId}</strong>`)
        .replace(/Geometría catastral real del recorte de prueba\./g, 'Geometría catastral canónica del expediente.')
        .replace("id:'8084401NH6388S'", `id:${quote(parcelId)}`)
        .replace("source:'Catastro INSPIRE · catastro_vila_area.xml'", `source:${quote('Catastro · geometría canónica del expediente')}`)
        .replace("rings:[[[246.36,200.77],[263.85,204.38],[257.47,235.26],[240.14,231.85],[246.36,200.77]]]", `rings:${JSON.stringify(rings)}`)
        .replace("nativeSize:{width:508,height:508}", `nativeSize:{width:${modernWidth},height:${modernHeight}}`)
        .replace("modern.src='02_moderno.png';", `modern.src=${quote(modern?.src || '')};`)
        .replace("historic.src='01_historico.png';", `historic.src=${quote(historical?.src || '')};`)
        .replace("HISTORIC_SIZE={width:508,height:508}", `HISTORIC_SIZE={width:${historical?.width || 0},height:${historical?.height || 0}}`)
        .replace("MODERN_SIZE={width:508,height:508}", `MODERN_SIZE={width:${modern?.width || 0},height:${modern?.height || 0}}`)
        .replace("DEFAULT_TRANSFORM=Object.freeze({x:294,y:104,rot:0,scx:1,scy:1,op:.55})", `DEFAULT_TRANSFORM=Object.freeze(${JSON.stringify(initialAlignment?.transform ? { ...initialAlignment.transform, op: .55 } : { x: 294, y: 104, rot: 0, scx: 1, scy: 1, op: .55 })})`)
        .replace("saveSession(){", `saveSession(){ window.parent.postMessage({ type: 'HAS_TERMINAR', payload: { s, view, parcel: { id: ${quote(parcelId)}, source: 'Catastro · geometría canónica del expediente' }, images: { historical: ${quote(historical?.provenance || null)}, modern: ${quote(modern?.provenance || null)} } } }, '*'); return; `)
        .replace('</body>', `<script>window.__HAS_CARTOGRAPHY__=${quote({ historical: historical?.provenance || null, modern: modern?.provenance || null, limitations: cartography?.limitations || [] })}</script></body>`);
      setSrcdoc(doc);
    }).catch(err => console.error('Failed to load HAS template', err));
  }, [expedienteId, hasEligibility, parcelGeometry, cadastralReference, cartography, initialAlignment]);

  useEffect(() => {
    const handleMessage = async (e: MessageEvent) => {
      if (e.data?.type === 'HAS_TERMINAR') {
        const payload = e.data.payload;
        const historical = cartography?.inputs.find(input => input.kind === 'historical');
        const modern = cartography?.inputs.find(input => input.kind === 'modern');
        if (persistAlignment && expedienteId && cadastralReference && historical && modern) {
          const transform = { x: payload.s.x, y: payload.s.y, rot: payload.s.rot, scx: payload.s.scx, scy: payload.s.scy };
          await persistAlignment({ expedienteId, cadastralReference, historicalViewId: historical.provenance.id, historicalProvenance: historical.provenance, modernViewId: modern.provenance.id, modernProvenance: modern.provenance, bbox: modern.provenance.bbox, crs: modern.provenance.crs, transform, nativeDimensions: { historical: { width: historical.width, height: historical.height }, modern: { width: modern.width, height: modern.height } } });
        }
        alert('HAS Terminado. Alineamiento persistido: ' + JSON.stringify(payload.s, null, 2));
        if (onClose) {
          onClose();
        } else if (expedienteId) {
          router.push(`/expedientes/${expedienteId}`);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [expedienteId, router, onClose, persistAlignment, cadastralReference, cartography]);

  const handleCancel = () => {
    if (onClose) onClose();
    else if (expedienteId) router.push(`/expedientes/${expedienteId}`);
  };

  return (
    <div className="flex flex-col w-full h-screen bg-zinc-950 text-white overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-zinc-800 shrink-0">
        <div>
          <h2 className="text-lg font-bold">HAS: {expedienteName}</h2>
          <p className="text-xs text-zinc-400">Ajuste por Superposición - {hasEligibility?.sheet?.id}</p>
        </div>
        <Button variant="outline" onClick={handleCancel}>Cancelar</Button>
      </div>
      <div className="flex-1 w-full bg-zinc-900 relative">
        {srcdoc ? (
          <iframe
            ref={iframeRef}
            className="w-full h-full border-none absolute inset-0"
            srcDoc={srcdoc}
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500">Cargando visor HAS...</div>
        )}
      </div>
      {(!parcelGeometry || !cartography?.inputs.some(input => input.kind === 'historical') || !cartography?.inputs.some(input => input.kind === 'modern')) && (
        <div className="border-t border-amber-800 bg-amber-950/60 px-4 py-2 text-sm text-amber-200">
          HAS no dispone de todas las entradas oficiales del expediente. No se han usado datos del prototipo.
          {cartography?.limitations?.length ? ` ${cartography.limitations.join(' ')}` : ''}
        </div>
      )}
    </div>
  );
}
