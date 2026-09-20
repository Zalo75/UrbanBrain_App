export interface LocalTranslationRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
  timeoutMs?: number;
}

export interface LocalTranslationResult {
  translatedText: string;
  model: string;
  provider: string;
  sourceLang: string;
  targetLang: string;
  placeholdersCount: number;
  elapsedMs: number;
}

export class LocalTranslationError extends Error {
  constructor(
    message: string,
    public readonly code: 'SERVICE_UNAVAILABLE' | 'FAIL_CLOSED' | 'INVALID_INPUT' | 'TIMEOUT' | 'UNKNOWN',
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'LocalTranslationError';
  }
}

export class LocalTranslationClient {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;

  constructor(baseUrl?: string, defaultTimeoutMs: number = 15000) {
    this.baseUrl = baseUrl || process.env.LOCAL_TRANSLATION_URL || 'http://127.0.0.1:5005';
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  /**
   * Fast health check to verify if the translation service sidecar is available.
   */
  async isAvailable(timeoutMs: number = 2000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) return false;
      const data = await res.json();
      return data.status === 'healthy';
    } catch {
      return false;
    }
  }

  /**
   * Translates text using the local sidecar service.
   * Enforces fail-closed behavior: never returns partial or unverified translations.
   */
  async translate(request: LocalTranslationRequest): Promise<LocalTranslationResult> {
    const { text, sourceLang, targetLang } = request;
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;

    if (!text || !text.trim()) {
      throw new LocalTranslationError(
        'El texto a traducir no puede estar vacío.',
        'INVALID_INPUT'
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          source_lang: sourceLang.toLowerCase(),
          target_lang: targetLang.toLowerCase(),
        }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LocalTranslationError(
          `Timeout de traducción local superado (${timeoutMs} ms).`,
          'TIMEOUT'
        );
      }
      throw new LocalTranslationError(
        'Servicio de traducción local no disponible en 127.0.0.1:5005. Verifique que el servicio sidecar esté iniciado.',
        'SERVICE_UNAVAILABLE',
        err
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (res.status === 422) {
      const errData = await res.json().catch(() => ({}));
      throw new LocalTranslationError(
        `FAIL_CLOSED: La traducción fue rechazada por alteración de datos normativos protegidos: ${JSON.stringify(errData.violations || errData.error)}`,
        'FAIL_CLOSED',
        errData
      );
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new LocalTranslationError(
        `Error del motor de traducción local (HTTP ${res.status}): ${errData.error || 'Fallo interno'}`,
        'UNKNOWN',
        errData
      );
    }

    const data = await res.json();
    if (!data.ok || !data.translated_text) {
      throw new LocalTranslationError(
        'Respuesta inválida del servicio de traducción.',
        'FAIL_CLOSED',
        data
      );
    }

    return {
      translatedText: data.translated_text,
      model: data.model || 'local-transformer-v1',
      provider: data.provider || 'local-ctranslate2',
      sourceLang: data.source_lang || sourceLang,
      targetLang: data.target_lang || targetLang,
      placeholdersCount: data.placeholders_count ?? 0,
      elapsedMs: data.elapsed_ms ?? 0,
    };
  }
}

export const localTranslationClient = new LocalTranslationClient();
