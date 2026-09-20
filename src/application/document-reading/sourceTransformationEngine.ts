import { db } from '@/infrastructure/db/client';
import { sourceTransformations } from '@/infrastructure/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  SourceDerivationRecord,
  TransformSourceRequest,
  TransformSourceResponse,
} from './types';
import { computeSourceHash } from './sourceHasher';
import { resolveAccreditedSourceText } from './sourceAccreditedResolver';
import { getSourceTransformationProvider } from './sourceTransformationProvider';
import { cleanDeterministicOcr } from './deterministicOcrCleaner';
import { detectDocumentLanguage } from './languageDetector';

export async function getExistingDerivationsForSource(
  expedienteId: string,
  sourceRef: string,
  sourceHash?: string
): Promise<SourceDerivationRecord[]> {
  if (sourceRef.startsWith('planning:evidence') || sourceRef.startsWith('synthetic:')) {
    return [];
  }

  const conditions = [
    eq(sourceTransformations.expedienteId, expedienteId),
    eq(sourceTransformations.sourceRef, sourceRef),
  ];

  if (sourceHash) {
    conditions.push(eq(sourceTransformations.sourceHash, sourceHash));
  }

  const records = await db
    .select()
    .from(sourceTransformations)
    .where(and(...conditions));

  return records.map((r) => ({
    id: r.id,
    expedienteId: r.expedienteId,
    sourceRef: r.sourceRef,
    sourceHash: r.sourceHash,
    derivationType: r.derivationType as SourceDerivationRecord['derivationType'],
    sourceLanguage: r.sourceLanguage,
    targetLanguage: r.targetLanguage,
    translationSource: r.translationSource as SourceDerivationRecord['translationSource'],
    inputDerivationId: r.inputDerivationId,
    inputDerivationHash: r.inputDerivationHash,
    derivedText: r.derivedText,
    model: r.model,
    provider: r.provider,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function transformSource(
  request: TransformSourceRequest
): Promise<TransformSourceResponse> {
  const { expedienteId, sourceRef, derivationType, targetLanguage } = request;

  if (sourceRef.startsWith('planning:evidence') || sourceRef.startsWith('synthetic:')) {
    throw new Error('FAIL_CLOSED_SYNTHETIC_SOURCE: Las fuentes sintéticas o de evidencia de planeamiento no admiten OCR ni traducción asistida.');
  }

  // CORRECTION 1: The client is NOT the authority. Resolve canonical text on server.
  const resolved = await resolveAccreditedSourceText(expedienteId, sourceRef);
  if (!resolved || !resolved.originalCanonicalText) {
    throw new Error('FAIL_CLOSED_NOT_ACCREDITED: No se pudo resolver la fuente acreditada en este expediente.');
  }

  // Calculate canonical SHA-256 hash on server
  const sourceHash = computeSourceHash(resolved.originalCanonicalText);
  const normalizedTargetLang = targetLanguage ? targetLanguage.trim().toLowerCase() : 'es';

  // Check DB cache for exact hit
  const cacheConditions = [
    eq(sourceTransformations.expedienteId, expedienteId),
    eq(sourceTransformations.sourceRef, sourceRef),
    eq(sourceTransformations.sourceHash, sourceHash),
    eq(sourceTransformations.derivationType, derivationType),
  ];

  if (derivationType === 'translation') {
    cacheConditions.push(eq(sourceTransformations.targetLanguage, normalizedTargetLang));
  }

  const cached = await db
    .select()
    .from(sourceTransformations)
    .where(and(...cacheConditions))
    .limit(1);

  if (cached.length > 0) {
    const r = cached[0];
    return {
      derivation: {
        id: r.id,
        expedienteId: r.expedienteId,
        sourceRef: r.sourceRef,
        sourceHash: r.sourceHash,
        derivationType: r.derivationType as SourceDerivationRecord['derivationType'],
        sourceLanguage: r.sourceLanguage,
        targetLanguage: r.targetLanguage,
        translationSource: r.translationSource as SourceDerivationRecord['translationSource'],
        inputDerivationId: r.inputDerivationId,
        inputDerivationHash: r.inputDerivationHash,
        derivedText: r.derivedText,
        model: r.model,
        provider: r.provider,
        createdAt: r.createdAt.toISOString(),
      },
      fromCache: true,
    };
  }

  // Prepare transformation and record provenance chain
  let derivedText = '';
  let model = '';
  let provider = '';
  let translationSource: 'original' | 'ocr_correction' | null = null;
  let inputDerivationId: string | null = null;
  let inputDerivationHash: string | null = null;
  let detectedSourceLang = 'es';

  if (derivationType === 'ocr_correction') {
    // CAMBIO DE DISEÑO: Limpieza OCR local determinista sin LLM (0 tokens, coste $0)
    derivedText = cleanDeterministicOcr(resolved.originalCanonicalText);
    provider = 'local';
    model = 'deterministic-ocr-cleaner-v1';
    detectedSourceLang = detectDocumentLanguage(resolved.originalCanonicalText).language;
  } else if (derivationType === 'translation') {
    // Check if an existing OCR correction derivation is already available for this exact sourceHash
    const existingOcr = await db
      .select()
      .from(sourceTransformations)
      .where(
        and(
          eq(sourceTransformations.expedienteId, expedienteId),
          eq(sourceTransformations.sourceRef, sourceRef),
          eq(sourceTransformations.sourceHash, sourceHash),
          eq(sourceTransformations.derivationType, 'ocr_correction')
        )
      )
      .limit(1);

    let inputText = '';
    if (existingOcr.length > 0 && existingOcr[0].derivedText) {
      translationSource = 'ocr_correction';
      inputDerivationId = existingOcr[0].id;
      inputDerivationHash = computeSourceHash(existingOcr[0].derivedText);
      inputText = existingOcr[0].derivedText;
    } else {
      translationSource = 'original';
      inputText = resolved.originalCanonicalText;
    }

    detectedSourceLang = detectDocumentLanguage(inputText).language;

    const transformationProvider = getSourceTransformationProvider();
    const result = await transformationProvider.transform({
      text: inputText,
      sourceLang: detectedSourceLang,
      targetLang: normalizedTargetLang,
    });

    derivedText = result.transformedText;
    model = result.model;
    provider = result.provider;
    if (result.sourceLang) {
      detectedSourceLang = result.sourceLang;
    }
  } else {
    throw new Error(`Tipo de derivación no soportado: ${String(derivationType)}`);
  }

  // Persist transformation
  const [inserted] = await db
    .insert(sourceTransformations)
    .values({
      expedienteId,
      sourceRef,
      sourceHash,
      derivationType,
      sourceLanguage: detectedSourceLang,
      targetLanguage: derivationType === 'translation' ? normalizedTargetLang : null,
      translationSource,
      inputDerivationId,
      inputDerivationHash,
      derivedText,
      model,
      provider,
    })
    .returning();

  return {
    derivation: {
      id: inserted.id,
      expedienteId: inserted.expedienteId,
      sourceRef: inserted.sourceRef,
      sourceHash: inserted.sourceHash,
      derivationType: inserted.derivationType as SourceDerivationRecord['derivationType'],
      sourceLanguage: inserted.sourceLanguage,
      targetLanguage: inserted.targetLanguage,
      translationSource: inserted.translationSource as SourceDerivationRecord['translationSource'],
      inputDerivationId: inserted.inputDerivationId,
      inputDerivationHash: inserted.inputDerivationHash,
      derivedText: inserted.derivedText,
      model: inserted.model,
      provider: inserted.provider,
      createdAt: inserted.createdAt.toISOString(),
    },
    fromCache: false,
  };
}
