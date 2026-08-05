'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

import type { ParcelGeometry } from '@/domain/territorial-resolver/types'

const LeafletPordViewer = dynamic(() => import('./LeafletPordViewer'), {
  ssr: false,
  loading: () => (
    <div className="bg-muted/40 flex h-[480px] w-full items-center justify-center rounded-md border">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground text-sm">Cargando visor cartográfico oficial…</p>
      </div>
    </div>
  ),
})

interface Props {
  municipality?: string
  instrument?: string
  tileIndex?: string
  wmsLayer?: string
  parcelGeometry?: ParcelGeometry
  actionAreaGeometry?: ParcelGeometry
}

export function PordPlanViewer(props: Props) {
  if (!props.wmsLayer) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        No se ha detectado ninguna capa PORD asociada a este expediente.
      </div>
    )
  }

  return <LeafletPordViewer {...props} />
}
