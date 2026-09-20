export type SourceDerivationType = 'ocr_correction' | 'translation';
export type TranslationSourceType = 'original' | 'ocr_correction';

export interface SourceDerivationRecord {
  id: string;
  expedienteId: string;
  sourceRef: string;
  sourceHash: string;
  derivationType: SourceDerivationType;
  sourceLanguage: string;
  targetLanguage?: string | null;
  translationSource?: TranslationSourceType | null;
  inputDerivationId?: string | null;
  inputDerivationHash?: string | null;
  derivedText: string;
  model: string;
  provider: string;
  createdAt: string;
}

export interface TransformSourceRequest {
  expedienteId: string;
  sourceRef: string;
  derivationType: SourceDerivationType;
  targetLanguage?: 'es' | 'gl' | 'ca' | 'eu' | 'en' | string | null;
}

export interface TransformSourceResponse {
  derivation: SourceDerivationRecord;
  fromCache: boolean;
}

export interface SourceTransformationProviderRequest {
  systemPrompt?: string;
  userPrompt?: string;
  temperature?: number;
  text?: string;
  sourceLang?: string;
  targetLang?: string;
}

export interface SourceTransformationProviderResponse {
  transformedText: string;
  provider: string;
  model: string;
  sourceLang?: string;
  targetLang?: string;
  placeholdersCount?: number;
  elapsedMs?: number;
}

export interface SourceTransformationProvider {
  readonly name: string;
  readonly defaultModel: string;
  transform(request: SourceTransformationProviderRequest): Promise<SourceTransformationProviderResponse>;
}
