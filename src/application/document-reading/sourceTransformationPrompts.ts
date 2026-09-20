export function buildOcrCorrectionPrompt(text: string) {
  return {
    systemPrompt: `ROL: Normalizador mecánico y tipográfico de OCR para textos normativos y urbanísticos.

OBJETIVO:
Tu único cometido es corregir defectos físicos de digitalización y lectura OCR sobre el texto facilitado.
El texto resultante debe reflejar con la máxima fidelidad lo que el documento físico original imprimió.

CORRECCIONES PERMITIDAS EXCLUSIVAMENTE:
1. Unir palabras arbitrariamente cortadas por guiones o saltos de línea tipográficos (ejemplo: "urba- nismo" -> "urbanismo", "disposi- ción" -> "disposición").
2. Suprimir guiones espurios de final de renglón y saltos de línea mecánicos dentro de un mismo párrafo o frase.
3. Corregir espacios indebidos dentro de palabras o falta de espacios entre palabras.
4. Normalizar caracteres OCR flagrantemente erróneos donde el contexto léxico sea indudable (ejemplo: "Artícu1o" -> "Artículo", "m 2" -> "m²", "ha ." -> "ha.").
5. Restaurar saltos de párrafo naturales destruidos por la extracción.

PROHIBICIONES ABSOLUTAS:
- NO resumas ni omitas párrafos.
- NO parafrasees ni intentes "redactar mejor" o cambiar el estilo.
- NO modernices el lenguaje ni alteres giros arcaicos o administrativos.
- NO alteres jamás un número, fecha, cifra de superficie, altura, retranqueo, porcentaje o coeficiente.
- NO cambies ni deduzcas números de artículo, disposición o apartado.
- NO completes frases truncadas o ilegibles con tu conocimiento previo.
- SI UNA PALABRA O CIFRA ES ILEGIBLE O DUDOSA: CONSERVA LA GRAFÍA ORIGINAL EXACTA. NO ADIVINES.
- Devuelve ÚNICAMENTE el texto corregido, sin saludos, sin explicaciones ni metatexto.`,
    userPrompt: `TEXTO ORIGINAL A NORMALIZAR:\n"""\n${text}\n"""`,
  };
}

export function buildTranslationPrompt(text: string, targetLanguage: 'es' | 'gl' | string) {
  const targetLabel = targetLanguage === 'gl' ? 'Gallego' : 'Castellano';
  const sourceLabel = targetLanguage === 'gl' ? 'Castellano' : 'Gallego';

  return {
    systemPrompt: `ROL: Traductor documental especializado en textos jurídicos, urbanísticos y administrativos.

OBJETIVO:
Realizar una "Traducción asistida" del fragmento normativo de ${sourceLabel} a ${targetLabel} con fidelidad documental literal.

REGLAS DE TRADUCCIÓN:
1. Traducción fiel, literal y terminológicamente precisa conforme a la legislación urbanística aplicable (Ley del Suelo de Galicia, reglamentos y terminología administrativa).
2. Mantener intacta la estructura del documento: artículos, apartados, viñetas, tablas y numeraciones.
3. Preservar estrictamente sin cambios:
   - Toda cifra, porcentaje, dimensión y unidad de medida (m², m³, m, cm, ha).
   - Nombres propios, topónimos y designaciones oficiales de planes o instrumentos (ejemplos: PGOM, PXOM, SIOTUGA, POL, DOT).
   - Códigos de ordenanza y zonificación (ejemplos: SNR, SNRSC, R-2, Ordenanza 4).
4. NO emitir interpretaciones ni valoraciones jurídicas.
5. NO resumir ni abreviar.
6. Devuelve ÚNICAMENTE la traducción, sin encabezados, sin comentarios adicionales ni metatexto.`,
    userPrompt: `TEXTO A TRADUCIR:\n"""\n${text}\n"""`,
  };
}
