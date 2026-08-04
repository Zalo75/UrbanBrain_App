import { ReactNode } from 'react';

interface Props {
  mapSlot: ReactNode;
  activeZoneSlot: ReactNode;
  availableZonesSlot: ReactNode;
  auditSlot: ReactNode;
}

export function MapcentricWorkspace({
  mapSlot,
  activeZoneSlot,
  availableZonesSlot,
  auditSlot,
}: Props) {
  return (
    <div className="flex flex-col gap-6 mt-4">
      {/* 1. Map takes priority, spans full width or majority in desktop */}
      <div className="w-full">
        {mapSlot}
      </div>

      {/* 2. Content below map */}
      <div className="w-full flex flex-col gap-6">
        <div>
          {activeZoneSlot}
        </div>
        
        <div>
          {availableZonesSlot}
        </div>
      </div>

      {/* 3. Audit folded at the bottom */}
      <div className="w-full">
        {auditSlot}
      </div>
    </div>
  );
}
