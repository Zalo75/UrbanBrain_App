/**
 * PII (Personally Identifiable Information) Stripper.
 * Reemplaza nombres, DNI, teléfonos o emails por placeholders para no enviar datos sensibles al LLM.
 * 
 * Esta es una función pura, sin dependencias de base de datos ni contexto externo.
 */
export function stripPII(text: string): string {
  if (!text) return text;

  let sanitized = text;

  // 1. Ocultar Emails (reemplazar por [EMAIL])
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  sanitized = sanitized.replace(emailRegex, '[EMAIL]');

  // 2. Ocultar DNIs/NIEs (aproximación básica para España: 8 números + letra o Letra + 7 números + Letra)
  const dniRegex = /\b([X-Z]\d{7}[A-Z]|\d{8}[A-Z])\b/gi;
  sanitized = sanitized.replace(dniRegex, '[DNI/NIE]');

  // 3. Ocultar Teléfonos Españoles (aprox. 9 dígitos empezando por 6, 7, 8 o 9, con posibles espacios)
  const phoneRegex = /(?:(?:\+34|0034)[\s-]*)?[6-9](?:[\s-]*\d){8}\b/g;
  sanitized = sanitized.replace(phoneRegex, '[TELÉFONO]');

  return sanitized;
}
