import { describe, it, expect } from 'vitest';
import { detectDocumentLanguage, getAvailableTargetLanguages } from './languageDetector';

describe('LanguageDetector', () => {
  it('detects Galician urban planning fragments', () => {
    const gl = "Artigo 188. Solo rústico de protección de infraestruturas. Pertencen a esta categoría os terreos ocupados polas redes de comunicacións e a súa zona de afección de 25,00 m.";
    const res = detectDocumentLanguage(gl);
    expect(res.language).toBe('gl');
    expect(res.confidence).toBeGreaterThan(0.5);
  });

  it('detects Catalan urban planning fragments', () => {
    const ca = "Article 54. Condicions d'edificació a la zona 13b. L'edificabilitat neta màxima serà de 1,20 m²st/m²s sobre la parcel·la neta.";
    const res = detectDocumentLanguage(ca);
    expect(res.language).toBe('ca');
  });

  it('detects Basque urban planning fragments', () => {
    const eu = "42. artikulua. Lurzoru urbanizaezineko azpiegitura-babesa. Kategoria honetan sartzen dira komunikazio-sareek hartutako lurrak eta haien 50 metroko babes-eremua.";
    const res = detectDocumentLanguage(eu);
    expect(res.language).toBe('eu');
  });

  it('detects English zoning regulations', () => {
    const en = "Article 28. Zoning Ordinance R-2. The maximum plot coverage shall not exceed 35%, with a floor area ratio of 0.75 and building height of 9 meters.";
    const res = detectDocumentLanguage(en);
    expect(res.language).toBe('en');
  });

  it('detects Spanish urban planning regulations', () => {
    const es = "Artículo 142.3. En la zona de ordenanza ORDENANZA-3, la ocupación máxima en planta baja será del 45%, con una edificabilidad neta de 0,85.";
    const res = detectDocumentLanguage(es);
    expect(res.language).toBe('es');
  });

  it('excludes source language from target options', () => {
    expect(getAvailableTargetLanguages('es')).toEqual(['gl', 'ca', 'eu', 'en']);
    expect(getAvailableTargetLanguages('gl')).toEqual(['es', 'ca', 'eu', 'en']);
    expect(getAvailableTargetLanguages('ca')).toEqual(['es', 'gl', 'eu', 'en']);
  });
});
