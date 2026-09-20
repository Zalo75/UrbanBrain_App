import { describe, expect, it } from 'vitest';
import { cleanDeterministicOcr } from './deterministicOcrCleaner';

describe('deterministicOcrCleaner', () => {
  describe('Idempotence: clean(clean(text)) === clean(text)', () => {
    const samples = [
      'Texto simple.',
      'condicio-\nnes de edifica-\nción en suelo rústico.',
      'Art. 216:\nRégimen del suelo y ordenación.\n\nLa parcela mínima será de 5.000 m².',
      'altura máxima 7,0? m con retranqueo de 3,00 m.',
      '0,40 m²/m² con ocupación del 60 %.\n\nDisposición final.',
      '  Espacios múltiples   y saltos \r\n\r\n\r\n triples  ',
    ];

    it.each(samples)('is strictly idempotent for sample: %j', (sample) => {
      const once = cleanDeterministicOcr(sample);
      const twice = cleanDeterministicOcr(once);
      expect(twice).toBe(once);
    });
  });

  describe('Preservation of Sensitive Data (Numbers, Codes, Dates, Units)', () => {
    const sensitiveTokens = [
      'Art. 188',
      'Artigo 216',
      '12,50 m²',
      '7,00 m',
      '8,50 m',
      '60 %',
      '0,40 m²/m²',
      'R-2',
      'SNRSC',
      'PXOM',
      '24/02/2000',
    ];

    it.each(sensitiveTokens)('preserves exact token without modification: %s', (token) => {
      const text = `Normativa aplicable: ${token} según el plan.`;
      const cleaned = cleanDeterministicOcr(text);
      expect(cleaned).toContain(token);
    });

    it('preserves decimal commas inside numbers without adding spaces', () => {
      expect(cleanDeterministicOcr('altura de 7,00 m y fondo de 12,50 m')).toBe(
        'altura de 7,00 m y fondo de 12,50 m'
      );
    });
  });

  describe('No Guessing / Ambiguous Text Unaltered', () => {
    it('does NOT infer or replace ambiguous characters in numbers or references', () => {
      expect(cleanDeterministicOcr('altura máxima 7,0? m')).toBe('altura máxima 7,0? m');
      expect(cleanDeterministicOcr('Art. 21?')).toBe('Art. 21?');
      expect(cleanDeterministicOcr('parcela mínirna')).toBe('parcela mínirna');
      expect(cleanDeterministicOcr('0,4O m²/m²')).toBe('0,4O m²/m²');
    });
  });

  describe('Hyphenated Line Breaks Recomposition', () => {
    it('recomposes words broken by hyphen at line breaks', () => {
      const input = 'condicio-\nnes de edifica-\nción';
      expect(cleanDeterministicOcr(input)).toBe('condiciones de edificación');
    });

    it('recomposes words with extra spaces around newline', () => {
      const input = 'urba-\n   nismo gallego';
      expect(cleanDeterministicOcr(input)).toBe('urbanismo gallego');
    });

    it('does not merge hyphenated code identifiers or negative numbers', () => {
      expect(cleanDeterministicOcr('Zona R-2')).toBe('Zona R-2');
    });
  });

  describe('Punctuation Spacing & Paragraph Structure', () => {
    it('cleans spurious spaces before punctuation', () => {
      const input = 'superficie , volumen y altura .';
      expect(cleanDeterministicOcr(input)).toBe('superficie, volumen y altura.');
    });

    it('ensures space after comma followed by letters', () => {
      const input = 'altura,anchura,fondo';
      expect(cleanDeterministicOcr(input)).toBe('altura, anchura, fondo');
    });

    it('preserves paragraph breaks and headers', () => {
      const input = 'Art. 216:\nRégimen del suelo\n\nLa parcela mínima será de 5.000 m².';
      expect(cleanDeterministicOcr(input)).toBe(
        'Art. 216:\nRégimen del suelo\n\nLa parcela mínima será de 5.000 m².'
      );
    });

    it('collapses excessive vertical spacing to at most two newlines', () => {
      const input = 'Párrafo 1.\n\n\n\n\nPárrafo 2.';
      expect(cleanDeterministicOcr(input)).toBe('Párrafo 1.\n\nPárrafo 2.');
    });
  });
});
