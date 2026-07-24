import { describe, expect, it } from 'vitest';

import { buildCatastroViewerLink, isControlledOfficialLink } from './officialResourceLinks';

describe('buildCatastroViewerLink', () => {
  it('construye el enlace oficial sin aceptar una URL del navegador', () => {
    const link = buildCatastroViewerLink('7709702NH4970N0001SZ');
    expect(link).toMatchObject({
      kind: 'catastro_viewer',
      label: 'Ver en Catastro',
      source: 'catastro',
    });
    expect(new URL(link!.url).hostname).toBe('www1.sedecatastro.gob.es');
    expect(new URL(link!.url).searchParams.get('refcat')).toBe('7709702NH4970N0001SZ');
  });

  it('no construye enlaces con referencias inválidas', () => {
    expect(buildCatastroViewerLink('javascript:alert(1)')).toBeUndefined();
  });

  it('rechaza enlaces no oficiales aunque tengan apariencia válida', () => {
    expect(
      isControlledOfficialLink({
        kind: 'siotuga_viewer',
        label: 'SIOTUGA',
        url: 'https://example.com/falso',
        source: 'siotuga',
        scope: 'municipality',
      })
    ).toBe(false);
  });
});
