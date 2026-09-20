/**
 * Deterministic OCR Cleaner
 *
 * Limpieza tipográfica y mecánica local de textos OCR sin intervención de LLM ni inferencia semántica.
 * Cumple con los principios de:
 * 1. Coste $0 y 0 tokens (local en TypeScript).
 * 2. Máxima seguridad jurídica: no infiere ni adivina contenido ambiguo o corrupto.
 * 3. Idempotencia matemática: clean(clean(text)) === clean(text).
 * 4. Preservación estricta de números, fechas, ordenanzas, artículos, unidades y citas.
 */

// Caracteres de control ASCII/Unicode espurios (excluye \t y \n)
const SPURIOUS_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFEFF]/g;

// Caracteres alfabéticos que soportan idiomas de España (castellano, gallego, etc.)
const LETTER = '[A-Za-zÁÉÍÓÚáéíóúÀÈÌÒÙàèìòùÂÊÎÔÛâêîôûÄËÏÖÜäëïöüÑñÇç]';
const LOWER_LETTER = '[a-záéíóúàèìòùâêîôûäëïöüñç]';

// Palabras partidas inequívocamente por guión tipográfico al final de línea
// Ejemplo: "condicio-\nnes" -> "condiciones", "edifica-\n  ción" -> "edificación"
const HYPHENATED_LINEBREAK = new RegExp(`(${LETTER})-\\s*\\n\\s*(${LETTER})`, 'g');

// Saltos de línea espurios dentro de una misma frase:
// Línea que termina en letra minúscula o coma, seguida inmediatamente de una línea que comienza en minúscula
// (excluye encabezados, listas numeradas, viñetas y títulos)
const IN_SENTENCE_LINEBREAK = new RegExp(`(${LOWER_LETTER}|[,;])\\n(?![\\n\\-\\u2022*\\d])\\s*(${LOWER_LETTER})`, 'g');

export function cleanDeterministicOcr(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') {
    return '';
  }

  // 1. Normalización canónica Unicode (NFC)
  let text = rawText.normalize('NFC');

  // 2. Eliminación de caracteres de control espurios y normalización de saltos de línea (\r\n -> \n)
  text = text
    .replace(SPURIOUS_CONTROL_CHARS, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // 3. Recomposición de palabras partidas por guión de final de renglón
  text = text.replace(HYPHENATED_LINEBREAK, '$1$2');

  // 4. Recomposición de saltos de línea artificiales dentro de frases en minúscula
  text = text.replace(IN_SENTENCE_LINEBREAK, '$1 $2');

  // 5. Normalización de espacios antes de signos de puntuación comunes (, . ; :)
  text = text
    .replace(/([A-Za-z0-9ÁÉÍÓÚáéíóúÀÈÌÒÙàèìòùÑñÇç])\s+([,;:?.!])/g, '$1$2')
    // Coma o punto y coma pegado a letra siguiente sin espacio: "altura,anchura" -> "altura, anchura"
    // (NO afecta a números como "7,00" o "12,50" porque la derecha exige LETTER)
    .replace(new RegExp(`([,;])(${LETTER})`, 'g'), '$1 $2');

  // 6. Normalización de espacios horizontales por renglón y recorte
  const lines = text.split('\n').map((line) => {
    return line.replace(/[^\S\n]+/g, ' ').trim();
  });

  text = lines.join('\n');

  // 7. Colapsar saltos de línea múltiples consecutivos (máximo 2 entre párrafos)
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

