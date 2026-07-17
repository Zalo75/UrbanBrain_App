export const CHUNK_QUALITY_REASON_CODES = [
  'EMPTY_OR_NON_TEXTUAL',
  'SYMBOL_DOMINATED',
  'EXTREME_SYMBOL_REPETITION',
  'EXTREME_TOKEN_REPETITION',
  'LOW_LETTER_DENSITY',
  'CODE_SEQUENCE_DOMINATED',
  'NO_NATURAL_LANGUAGE',
] as const

export type ChunkQualityReasonCode = (typeof CHUNK_QUALITY_REASON_CODES)[number]

export interface ChunkTextQualityInput {
  text: string
  chunkType?: string | null
}

export interface ChunkTextQualityMetrics {
  characterCount: number
  nonWhitespaceCharacterCount: number
  letterCount: number
  digitCount: number
  wordCount: number
  distinctWordCount: number
  letterRatio: number
  symbolRatio: number
  lexicalDiversity: number
  dominantWordRatio: number
  naturalWordRatio: number
  codeLikeTokenRatio: number
  naturalSentenceCount: number
  maximumRepeatedSymbolRun: number
  protectedLegalChunkType: boolean
}

export interface ChunkTextQualityResult {
  eligible: boolean
  reasonCodes: ChunkQualityReasonCode[]
  metrics: ChunkTextQualityMetrics
}

export interface ChunkQualityStatistics {
  evaluated: number
  eligible: number
  rejected: number
  rejectedByReason: Record<ChunkQualityReasonCode, number>
}

const PROTECTED_LEGAL_TYPES = [
  'ARTICULO',
  'ORDENANZA',
  'CAPITULO',
  'TITULO',
  'DISPOSICION',
  'SECCION',
  'ANEXO',
]

const NATURAL_CONNECTORS = new Set([
  'a', 'al', 'as', 'con', 'da', 'das', 'de', 'del', 'do', 'dos', 'e', 'el', 'en',
  'la', 'las', 'los', 'na', 'nas', 'no', 'nos', 'o', 'os', 'para', 'por', 'que',
  'se', 'será', 'seran', 'serán', 'un', 'una', 'y',
])

const LEGAL_TERMS = new Set([
  'altura', 'anexo', 'artículo', 'articulo', 'capítulo', 'capitulo', 'condiciones',
  'disposición', 'disposicion', 'edificabilidad', 'ocupación', 'ocupacion',
  'ordenanza', 'parcela', 'planeamiento', 'retranqueo', 'sección', 'seccion',
  'suelo', 'título', 'titulo', 'uso', 'vivienda',
])

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator
}

function normalizeIdentifier(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

function isProtectedLegalType(chunkType: string | null | undefined) {
  const normalized = normalizeIdentifier(chunkType ?? '')
  return PROTECTED_LEGAL_TYPES.some((type) => normalized.includes(type))
}

function wordsIn(text: string) {
  return text.match(/[\p{L}\p{N}]+(?:[./ºª-][\p{L}\p{N}]+)*/gu) ?? []
}

function isNaturalWord(token: string) {
  const lower = token.toLocaleLowerCase('es')
  if (NATURAL_CONNECTORS.has(lower) || LEGAL_TERMS.has(lower)) return true
  return /^[\p{L}]{3,}$/u.test(token) && /[\p{Ll}]/u.test(token)
}

function isCodeLikeToken(token: string) {
  const lower = token.toLocaleLowerCase('es')
  if (NATURAL_CONNECTORS.has(lower) || LEGAL_TERMS.has(lower)) return false
  if (/^\d+(?:[.,]\d+)*%?$/u.test(token)) return true
  if (/\d/u.test(token) && /[\p{L}]/u.test(token)) return true
  if (/[/-]/u.test(token)) return true
  return /^[\p{Lu}]{1,12}$/u.test(token)
}

function countNaturalSentences(text: string) {
  return text
    .split(/[.!?;\n]+/u)
    .map((part) => wordsIn(part))
    .filter((tokens) => {
      if (tokens.length < 4) return false
      const naturalWords = tokens.filter(isNaturalWord).length
      const hasConnectorOrLegalTerm = tokens.some((token) => {
        const lower = token.toLocaleLowerCase('es')
        return NATURAL_CONNECTORS.has(lower) || LEGAL_TERMS.has(lower)
      })
      return hasConnectorOrLegalTerm && ratio(naturalWords, tokens.length) >= 0.45
    }).length
}

function maximumRepeatedSymbolRun(text: string) {
  let maximum = 0
  let previous = ''
  let current = 0
  for (const character of Array.from(text)) {
    const isSymbol = !/[\p{L}\p{N}\s]/u.test(character)
    if (!isSymbol) {
      previous = ''
      current = 0
      continue
    }
    if (character === previous) current += 1
    else {
      previous = character
      current = 1
    }
    maximum = Math.max(maximum, current)
  }
  return maximum
}

function dominantTokenMetrics(tokens: string[]) {
  if (tokens.length === 0) return { token: '', ratio: 0 }
  const frequencies = new Map<string, number>()
  for (const token of tokens) {
    const normalized = token.toLocaleLowerCase('es')
    frequencies.set(normalized, (frequencies.get(normalized) ?? 0) + 1)
  }
  let dominantToken = ''
  let dominantCount = 0
  for (const [token, count] of frequencies) {
    if (count > dominantCount) {
      dominantToken = token
      dominantCount = count
    }
  }
  return { token: dominantToken, ratio: dominantCount / tokens.length }
}

export function evaluateChunkTextQuality(
  input: ChunkTextQualityInput
): ChunkTextQualityResult {
  const text = input.text.normalize('NFC').trim()
  const characters = Array.from(text)
  const nonWhitespace = characters.filter((character) => !/\s/u.test(character))
  const letterCount = characters.filter((character) => /\p{L}/u.test(character)).length
  const digitCount = characters.filter((character) => /\p{N}/u.test(character)).length
  const symbolCount = nonWhitespace.filter(
    (character) => !/[\p{L}\p{N}]/u.test(character)
  ).length
  const words = wordsIn(text)
  const normalizedWords = words.map((word) => word.toLocaleLowerCase('es'))
  const distinctWordCount = new Set(normalizedWords).size
  const naturalWordCount = words.filter(isNaturalWord).length
  const codeLikeTokenCount = words.filter(isCodeLikeToken).length
  const naturalSentenceCount = countNaturalSentences(text)
  const repeatedSymbolRun = maximumRepeatedSymbolRun(text)
  const rawTokens = text.split(/\s+/u).filter(Boolean)
  const dominantRawToken = dominantTokenMetrics(rawTokens)
  const dominantWord = dominantTokenMetrics(normalizedWords)
  const protectedLegalChunkType = isProtectedLegalType(input.chunkType)

  const metrics: ChunkTextQualityMetrics = {
    characterCount: characters.length,
    nonWhitespaceCharacterCount: nonWhitespace.length,
    letterCount,
    digitCount,
    wordCount: words.length,
    distinctWordCount,
    letterRatio: ratio(letterCount, nonWhitespace.length),
    symbolRatio: ratio(symbolCount, nonWhitespace.length),
    lexicalDiversity: ratio(distinctWordCount, words.length),
    dominantWordRatio: dominantWord.ratio,
    naturalWordRatio: ratio(naturalWordCount, words.length),
    codeLikeTokenRatio: ratio(codeLikeTokenCount, words.length),
    naturalSentenceCount,
    maximumRepeatedSymbolRun: repeatedSymbolRun,
    protectedLegalChunkType,
  }

  const emptyOrNonTextual = text.length === 0 || (letterCount === 0 && digitCount === 0)
  const symbolDominated =
    metrics.symbolRatio >= 0.6 ||
    (metrics.letterRatio < 0.15 && metrics.symbolRatio >= 0.35)
  const extremeSymbolRepetition =
    repeatedSymbolRun >= 8 ||
    (rawTokens.length >= 8 &&
      dominantRawToken.ratio >= 0.7 &&
      !/[\p{L}\p{N}]/u.test(dominantRawToken.token))
  const extremeTokenRepetition =
    words.length >= 8 &&
    metrics.dominantWordRatio >= 0.6 &&
    metrics.lexicalDiversity <= 0.25
  const lowLetterDensity =
    words.length >= 8 && metrics.letterRatio < 0.35 && naturalSentenceCount === 0
  const codeSequenceDominated =
    words.length >= 8 &&
    metrics.codeLikeTokenRatio >= 0.58 &&
    metrics.naturalWordRatio <= 0.28 &&
    naturalSentenceCount === 0
  const noNaturalLanguage =
    words.length >= 16 && metrics.naturalWordRatio < 0.12 && naturalSentenceCount === 0

  const reasons: ChunkQualityReasonCode[] = []
  if (emptyOrNonTextual) reasons.push('EMPTY_OR_NON_TEXTUAL')
  if (symbolDominated) reasons.push('SYMBOL_DOMINATED')
  if (extremeSymbolRepetition) reasons.push('EXTREME_SYMBOL_REPETITION')
  if (extremeTokenRepetition) reasons.push('EXTREME_TOKEN_REPETITION')

  if (protectedLegalChunkType) {
    const unequivocalCodeSequence =
      words.length >= 8 &&
      metrics.codeLikeTokenRatio >= 0.8 &&
      metrics.naturalWordRatio < 0.15 &&
      naturalSentenceCount === 0
    if (unequivocalCodeSequence) reasons.push('CODE_SEQUENCE_DOMINATED')
  } else {
    if (lowLetterDensity) reasons.push('LOW_LETTER_DENSITY')
    if (codeSequenceDominated) reasons.push('CODE_SEQUENCE_DOMINATED')
    if (noNaturalLanguage) reasons.push('NO_NATURAL_LANGUAGE')
  }

  return {
    eligible: reasons.length === 0,
    reasonCodes: [...new Set(reasons)],
    metrics,
  }
}

export function createChunkQualityStatistics(): ChunkQualityStatistics {
  return {
    evaluated: 0,
    eligible: 0,
    rejected: 0,
    rejectedByReason: Object.fromEntries(
      CHUNK_QUALITY_REASON_CODES.map((reason) => [reason, 0])
    ) as Record<ChunkQualityReasonCode, number>,
  }
}

export function addChunkQualityResult(
  current: ChunkQualityStatistics,
  result: ChunkTextQualityResult
): ChunkQualityStatistics {
  const rejectedByReason = { ...current.rejectedByReason }
  for (const reason of result.reasonCodes) {
    rejectedByReason[reason] += 1
  }
  return {
    evaluated: current.evaluated + 1,
    eligible: current.eligible + (result.eligible ? 1 : 0),
    rejected: current.rejected + (result.eligible ? 0 : 1),
    rejectedByReason,
  }
}
