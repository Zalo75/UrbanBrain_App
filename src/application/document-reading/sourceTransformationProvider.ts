import {
  SourceTransformationProvider,
  SourceTransformationProviderRequest,
  SourceTransformationProviderResponse,
} from './types';
import { localTranslationClient, LocalTranslationError } from '@/infrastructure/translation/localTranslationClient';
import { detectDocumentLanguage } from './languageDetector';

export class LocalSourceTransformationProvider implements SourceTransformationProvider {
  readonly name = 'local-ctranslate2';
  readonly defaultModel = 'local-normative-shield-v1';

  async transform(request: SourceTransformationProviderRequest): Promise<SourceTransformationProviderResponse> {
    // 1. Resolve raw text
    let text = request.text || '';
    if (!text && request.userPrompt) {
      const match = /"""\n([\s\S]*?)\n"""/.exec(request.userPrompt);
      text = match ? match[1] : request.userPrompt;
    }
    text = text.trim();

    if (!text) {
      throw new Error('El texto para traducción documental asistida no puede estar vacío.');
    }

    // 2. Resolve source language (detect if not provided)
    const sourceLang = request.sourceLang || detectDocumentLanguage(text).language;
    const targetLang = request.targetLang || 'es';

    if (sourceLang === targetLang) {
      return {
        transformedText: text,
        provider: this.name,
        model: 'identity-passthrough',
        sourceLang,
        targetLang,
      };
    }

    try {
      const res = await localTranslationClient.translate({
        text,
        sourceLang,
        targetLang,
      });

      return {
        transformedText: res.translatedText,
        provider: res.provider,
        model: res.model,
        sourceLang: res.sourceLang,
        targetLang: res.targetLang,
        placeholdersCount: res.placeholdersCount,
        elapsedMs: res.elapsedMs,
      };
    } catch (err: unknown) {
      if (err instanceof LocalTranslationError) {
        if (err.code === 'FAIL_CLOSED') {
          throw new Error(`FAIL_CLOSED: La verificación de blindaje normativo rechazó la traducción: ${err.message}`);
        }
        if (err.code === 'SERVICE_UNAVAILABLE') {
          throw new Error('Servicio de transformación documental no configurado o no disponible en 127.0.0.1:5005.');
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Error en el servicio de traducción documental local: ${msg}`);
    }
  }
}

export class StubSourceTransformationProvider implements SourceTransformationProvider {
  readonly name = 'stub';
  readonly defaultModel = 'stub-transformer-v1';

  async transform(request: SourceTransformationProviderRequest): Promise<SourceTransformationProviderResponse> {
    let input = request.text || '';
    if (!input && request.userPrompt) {
      const rawMatch = /"""\n([\s\S]*?)\n"""/.exec(request.userPrompt);
      input = rawMatch ? rawMatch[1] : request.userPrompt;
    }

    let output = input
      .replace(/-\s*\n\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (request.targetLang && request.targetLang !== 'es') {
      output = `[Traducido a ${request.targetLang}]: ${output}`;
    } else if (request.systemPrompt?.includes('Traductor documental')) {
      output = `[Traducido]: ${output}`;
    }

    return {
      transformedText: output,
      provider: this.name,
      model: this.defaultModel,
      sourceLang: request.sourceLang || 'auto',
      targetLang: request.targetLang || 'es',
    };
  }
}

let activeProviderOverride: SourceTransformationProvider | null = null;

export function setSourceTransformationProviderOverride(provider: SourceTransformationProvider | null) {
  activeProviderOverride = provider;
}

export function getSourceTransformationProvider(): SourceTransformationProvider {
  if (activeProviderOverride) {
    return activeProviderOverride;
  }

  const configured = (process.env.SOURCE_TRANSFORMATION_PROVIDER || '').trim().toLowerCase();

  // 1. Explicit stub: only allowed if explicitly configured as 'stub' or in test environment
  if (configured === 'stub') {
    return new StubSourceTransformationProvider();
  }

  // 2. In automated tests without explicit override, allow stub fallback
  if (process.env.NODE_ENV === 'test' && !configured) {
    return new StubSourceTransformationProvider();
  }

  // 3. 100% Local Machine Translation (No Gemini, No OpenAI in execution path)
  return new LocalSourceTransformationProvider();
}
