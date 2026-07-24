import type {
  OfficialResourceLink,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types';

export function isControlledOfficialLink(link: OfficialResourceLink) {
  try {
    const url = new URL(link.url);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (link.source === 'catastro') {
      return url.hostname === 'sedecatastro.gob.es' || url.hostname.endsWith('.sedecatastro.gob.es');
    }
    if (link.source === 'siotuga' || link.source === 'ideg') {
      return url.hostname === 'xunta.gal' || url.hostname.endsWith('.xunta.gal');
    }
    if (link.source === 'cartociudad') {
      return url.hostname === 'cartociudad.es' || url.hostname.endsWith('.cartociudad.es');
    }
    // Municipal viewers can use different official domains, but their URLs only
    // enter this contract through the server-side versioned registry.
    return link.source === 'municipal';
  } catch {
    return false;
  }
}

export function buildCatastroViewerLink(
  cadastralReference?: string | null
): OfficialResourceLink | undefined {
  const normalized = cadastralReference?.replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (!normalized || ![14, 18, 20].includes(normalized.length)) return undefined;
  return {
    kind: 'catastro_viewer',
    label: 'Ver en Catastro',
    url: `https://www1.sedecatastro.gob.es/Cartografia/mapa.aspx?refcat=${encodeURIComponent(normalized)}`,
    source: 'catastro',
    scope: 'parcel',
  };
}

export function officialResourceLinks(result: TerritorialResolution): OfficialResourceLink[] {
  const catastro = buildCatastroViewerLink(
    result.cadastralReference ?? result.parcelReference
  );
  const planning = (result.planning.classificationResolution?.officialLinks ?? []).filter(
    isControlledOfficialLink
  );
  const instrumentCandidate: OfficialResourceLink | undefined = result.planning.sourceUrl
    ? {
        kind: 'planning_document',
        label: 'Ver planeamiento oficial',
        url: result.planning.sourceUrl,
        source: 'siotuga',
        scope: 'instrument',
      }
    : undefined;
  const instrument =
    instrumentCandidate && isControlledOfficialLink(instrumentCandidate)
      ? [instrumentCandidate]
      : [];
  return [
    ...new Map(
      [...(catastro ? [catastro] : []), ...planning, ...instrument].map((link) => [
        `${link.kind}|${link.url}`,
        link,
      ])
    ).values(),
  ];
}
