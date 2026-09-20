import { describe, expect, it, vi, beforeEach } from 'vitest';
import { computeSourceHash } from './sourceHasher';
import {
  buildOcrCorrectionPrompt,
  buildTranslationPrompt,
} from './sourceTransformationPrompts';
import {
  StubSourceTransformationProvider,
  LocalSourceTransformationProvider,
  getSourceTransformationProvider,
  setSourceTransformationProviderOverride,
} from './sourceTransformationProvider';
import {
  transformSource,
} from './sourceTransformationEngine';

interface MockRecord {
  id: string;
  expedienteId: string;
  sourceRef: string;
  sourceHash: string;
  derivationType: string;
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  translationSource?: string | null;
  inputDerivationId?: string | null;
  inputDerivationHash?: string | null;
  derivedText: string;
  model: string;
  provider: string;
  createdAt: Date;
}

const mockStore: MockRecord[] = [];

function searchForType(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const record = obj as Record<string, unknown>;
  if (record.value === 'ocr_correction' || record.value === 'translation') return record.value;
  for (const key of Object.keys(record)) {
    if (key === 'table' || key === 'schema') continue;
    try {
      const found = searchForType(record[key]);
      if (found) return found;
    } catch {
      // skip
    }
  }
  return null;
}

vi.mock('@/infrastructure/db/client', () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((condition: unknown) => {
            const targetType = searchForType(condition);
            const results = targetType
              ? mockStore.filter((r) => r.derivationType === targetType)
              : [...mockStore];

            return {
              orderBy: vi.fn(() => Promise.resolve(results)),
              limit: vi.fn((n: number) => Promise.resolve(results.slice(0, n))),
            };
          }),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((vals: Omit<MockRecord, 'id' | 'createdAt'>) => ({
          returning: vi.fn(() => {
            const inserted: MockRecord = {
              id: 'derivation-uuid-' + (mockStore.length + 1),
              createdAt: new Date(),
              ...vals,
            };
            mockStore.push(inserted);
            return Promise.resolve([inserted]);
          }),
        })),
      })),
    },
  };
});

const mockResolvedSource = {
  sourceRef: 'chunk-46725-001',
  documentName: 'PXOM Cariño - Normativa',
  originalCanonicalText: 'Artigo 12.- Condicións de edificación e alturas.',
};

vi.mock('./sourceAccreditedResolver', () => ({
  resolveAccreditedSourceText: vi.fn(async (expedienteId: string, sourceRef: string) => {
    if (sourceRef === 'unaccredited-source') {
      return null; // FAIL CLOSED
    }
    return {
      ...mockResolvedSource,
      sourceRef,
    };
  }),
}));

describe('Source Transformations & Reading Layer', () => {
  beforeEach(() => {
    mockStore.length = 0;
    setSourceTransformationProviderOverride(new StubSourceTransformationProvider());
    vi.clearAllMocks();
  });

  describe('sourceHasher', () => {
    it('generates consistent SHA-256 hash regardless of leading/trailing whitespace', () => {
      const hash1 = computeSourceHash('Artigo 12.- Condicións');
      const hash2 = computeSourceHash('   Artigo 12.- Condicións \n\t');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('normalizes Unicode NFC form before hashing', () => {
      const nfc = 'Condicións';
      const nfd = 'Condicio\u0301ns';
      expect(computeSourceHash(nfc)).toBe(computeSourceHash(nfd));
    });
  });

  describe('sourceTransformationPrompts', () => {
    it('uses the mandatory specialized documentary translator role', () => {
      const prompt = buildTranslationPrompt('Texto galego', 'es');
      expect(prompt.systemPrompt).toContain(
        'Traductor documental especializado en textos jurídicos, urbanísticos y administrativos'
      );
    });

    it('enforces assisted translation naming and forbids official translation claims', () => {
      const prompt = buildTranslationPrompt('Texto galego', 'es');
      expect(prompt.systemPrompt).toContain('Traducción asistida');
      expect(prompt.systemPrompt).toContain('fidelidad documental literal');
    });

    it('builds OCR correction prompt forbidding invention or modification of numbers and norms', () => {
      const prompt = buildOcrCorrectionPrompt('Art. 5   Parcela  minima: 500  m2');
      expect(prompt.userPrompt).toContain('Art. 5   Parcela  minima: 500  m2');
      expect(prompt.systemPrompt).toContain('NO alteres jamás un número');
      expect(prompt.systemPrompt).toContain('Normalizador mecánico y tipográfico de OCR');
    });
  });

  describe('sourceTransformationProvider abstraction', () => {
    it('instantiates providers conforming to SourceTransformationProvider interface', () => {
      const stub = new StubSourceTransformationProvider();
      expect(stub.name).toBe('stub');
      expect(stub.defaultModel).toBe('stub-transformer-v1');

      const local = new LocalSourceTransformationProvider();
      expect(local.name).toBe('local-ctranslate2');
      expect(local.defaultModel).toBe('local-normative-shield-v1');
    });

    it('Stub provider cleans OCR line-breaks and prefixes translations', async () => {
      const provider = new StubSourceTransformationProvider();
      const ocrPrompt = buildOcrCorrectionPrompt('urba-\n nismo');
      const ocrResult = await provider.transform(ocrPrompt);
      expect(ocrResult.transformedText).toBe('urbanismo');

      const transPrompt = buildTranslationPrompt('Artigo 12.- Edificación', 'es');
      const transResult = await provider.transform(transPrompt);
      expect(transResult.transformedText).toContain('[Traducido]: Artigo 12.- Edificación');
    });

    it('uses LocalSourceTransformationProvider by default when not stub', () => {
      setSourceTransformationProviderOverride(null);
      const prevProvider = process.env.SOURCE_TRANSFORMATION_PROVIDER;
      const prevNodeEnv = process.env.NODE_ENV;

      try {
        process.env.SOURCE_TRANSFORMATION_PROVIDER = 'local';
        process.env.NODE_ENV = 'production';
        const provider = getSourceTransformationProvider();
        expect(provider.name).toBe('local-ctranslate2');
      } finally {
        process.env.SOURCE_TRANSFORMATION_PROVIDER = prevProvider;
        process.env.NODE_ENV = prevNodeEnv;
        setSourceTransformationProviderOverride(new StubSourceTransformationProvider());
      }
    });
  });

  describe('sourceTransformationEngine & Server Authority', () => {
    it('FAILS CLOSED when sourceRef is a synthetic source reference (planning:evidence or synthetic:*)', async () => {
      await expect(
        transformSource({
          expedienteId: 'exp-123',
          sourceRef: 'planning:evidence',
          derivationType: 'ocr_correction',
        })
      ).rejects.toThrow('FAIL_CLOSED_SYNTHETIC_SOURCE');

      await expect(
        transformSource({
          expedienteId: 'exp-123',
          sourceRef: 'synthetic:summary-layer',
          derivationType: 'translation',
          targetLanguage: 'es',
        })
      ).rejects.toThrow('FAIL_CLOSED_SYNTHETIC_SOURCE');
    });
    it('FAILS CLOSED when sourceRef is not accredited in the expediente', async () => {
      await expect(
        transformSource({
          expedienteId: 'exp-123',
          sourceRef: 'unaccredited-source',
          derivationType: 'ocr_correction',
        })
      ).rejects.toThrow('FAIL_CLOSED_NOT_ACCREDITED');
    });

    it('performs OCR correction on accredited original text and persists provenance', async () => {
      const result = await transformSource({
        expedienteId: 'exp-123',
        sourceRef: 'chunk-46725-001',
        derivationType: 'ocr_correction',
      });

      expect(result.fromCache).toBe(false);
      expect(result.derivation.derivationType).toBe('ocr_correction');
      expect(result.derivation.provider).toBe('local');
      expect(result.derivation.model).toBe('deterministic-ocr-cleaner-v1');
      expect(result.derivation.sourceHash).toBe(computeSourceHash(mockResolvedSource.originalCanonicalText));
      expect(mockStore).toHaveLength(1);
      expect(mockStore[0].derivationType).toBe('ocr_correction');
      expect(mockStore[0].provider).toBe('local');
      expect(mockStore[0].model).toBe('deterministic-ocr-cleaner-v1');
    });

    it('reuses existing derivation from cache on repeated requests', async () => {
      await transformSource({
        expedienteId: 'exp-123',
        sourceRef: 'chunk-46725-001',
        derivationType: 'ocr_correction',
      });

      const result = await transformSource({
        expedienteId: 'exp-123',
        sourceRef: 'chunk-46725-001',
        derivationType: 'ocr_correction',
      });

      expect(result.fromCache).toBe(true);
      expect(mockStore).toHaveLength(1);
    });

    it('chains provenance when translating from existing OCR correction', async () => {
      const ocrResult = await transformSource({
        expedienteId: 'exp-123',
        sourceRef: 'chunk-46725-001',
        derivationType: 'ocr_correction',
      });

      const transResult = await transformSource({
        expedienteId: 'exp-123',
        sourceRef: 'chunk-46725-001',
        derivationType: 'translation',
        targetLanguage: 'es',
      });

      expect(transResult.derivation.translationSource).toBe('ocr_correction');
      expect(transResult.derivation.inputDerivationId).toBe(ocrResult.derivation.id);
      expect(transResult.derivation.inputDerivationHash).toBe(computeSourceHash(ocrResult.derivation.derivedText));
    });

    it('translates directly from original when no OCR derivation exists', async () => {
      const transResult = await transformSource({
        expedienteId: 'exp-123',
        sourceRef: 'chunk-46725-001',
        derivationType: 'translation',
        targetLanguage: 'es',
      });

      expect(transResult.derivation.translationSource).toBe('original');
      expect(transResult.derivation.inputDerivationId).toBeNull();
      expect(transResult.derivation.inputDerivationHash).toBeNull();
    });
  });
});
