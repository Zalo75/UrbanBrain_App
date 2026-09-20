export type SupportedLanguage = 'es' | 'gl' | 'ca' | 'eu' | 'en';

export interface LanguageDetectionResult {
  language: SupportedLanguage;
  confidence: number;
  scores: Record<SupportedLanguage, number>;
}

const BASQUE_KEYWORDS = [
  'artikulua', 'artikulu', 'lurzoru', 'lurzoruaren', 'eraikigarritasuna', 
  'eremuan', 'dira', 'ditu', 'eta', 'ez', 'edo', 'izan', 'dira', 'dago', 
  'batera', 'gutxieneko', 'gehieneko', 'azalera', 'lursailaren', 'partzelan'
];

const CATALAN_KEYWORDS = [
  'amb', 'perquè', 'aquest', 'aquesta', 'dels', 'deles', 'seva', 'seus',
  'edificabilitat', 'alçada', 'façana', 'condicions', 'parcel·la', 'neta',
  'màxima', 'mínima', 'sobre', 'reguladora', 'plantes', 'pis'
];

const GALICIAN_KEYWORDS = [
  'polo', 'pola', 'polos', 'polas', 'cunha', 'dunha', 'cun', 'dun',
  'súa', 'súas', 'terreos', 'terreo', 'edificabilidade', 'ordeación',
  'ademais', 'tamén', 'onde', 'chan', 'solo rústico', 'afección',
  'artigo', 'condicións', 'indivisíbel', 'fronte', 'recomponse'
];

const ENGLISH_KEYWORDS = [
  'the', 'of', 'and', 'in', 'to', 'is', 'for', 'shall', 'with', 'as', 
  'by', 'article', 'maximum', 'minimum', 'height', 'coverage', 'setback', 
  'zoning', 'ordinance', 'residential', 'plot', 'building'
];

const SPANISH_KEYWORDS = [
  'el', 'la', 'los', 'las', 'del', 'al', 'para', 'por', 'con', 'este',
  'esta', 'artículo', 'suelo', 'edificación', 'ordenanza', 'será', 
  'edificabilidad', 'retranqueo', 'lindeiro', 'linderos', 'parcela', 'finca'
];

/**
 * Lightweight deterministic language detector for UrbanBrain supported languages.
 * Operates in < 0.1 ms with zero external dependencies.
 */
export function detectDocumentLanguage(text: string): LanguageDetectionResult {
  if (!text || !text.trim()) {
    return {
      language: 'es',
      confidence: 0,
      scores: { es: 0, gl: 0, ca: 0, eu: 0, en: 0 },
    };
  }

  const normalized = text.toLowerCase();
  const words = normalized.split(/[\s,.;:()\[\]"'/+]+/).filter((w) => w.length > 1);

  const scores: Record<SupportedLanguage, number> = {
    es: 0,
    gl: 0,
    ca: 0,
    eu: 0,
    en: 0,
  };

  // Check specific morphological markers
  if (/(\bd'|\bl'|\bs'|·)/i.test(normalized)) {
    scores.ca += 15;
  }
  if (/(tx|tz|ts|\w+ko\b|\w+ren\b|\w+ekin\b)/i.test(normalized)) {
    scores.eu += 15;
  }
  if (/(cunha|dunha|polas|polos|afección|artigo)/i.test(normalized)) {
    scores.gl += 15;
  }

  for (const word of words) {
    if (BASQUE_KEYWORDS.includes(word)) scores.eu += 5;
    if (CATALAN_KEYWORDS.includes(word)) scores.ca += 5;
    if (GALICIAN_KEYWORDS.includes(word)) scores.gl += 5;
    if (ENGLISH_KEYWORDS.includes(word)) scores.en += 5;
    if (SPANISH_KEYWORDS.includes(word)) scores.es += 3;
  }

  // Find best match
  let bestLang: SupportedLanguage = 'es';
  let maxScore = -1;

  for (const [lang, score] of Object.entries(scores) as [SupportedLanguage, number][]) {
    if (score > maxScore) {
      maxScore = score;
      bestLang = lang;
    }
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = total > 0 ? maxScore / total : 0.5;

  return {
    language: bestLang,
    confidence: Number(confidence.toFixed(2)),
    scores,
  };
}

/**
 * Returns available target languages excluding the detected source language.
 */
export function getAvailableTargetLanguages(sourceLang: SupportedLanguage): SupportedLanguage[] {
  const all: SupportedLanguage[] = ['es', 'gl', 'ca', 'eu', 'en'];
  return all.filter((l) => l !== sourceLang);
}
