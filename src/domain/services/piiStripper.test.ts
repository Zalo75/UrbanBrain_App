import { describe, it, expect } from 'vitest';
import { stripPII } from './piiStripper';

describe('PII Stripper Service', () => {
  it('should remove email addresses', () => {
    const input = 'Contacta con juan.perez@estudio.com para más detalles.';
    const result = stripPII(input);
    expect(result).toBe('Contacta con [EMAIL] para más detalles.');
  });

  it('should remove DNI/NIE', () => {
    const input = 'El promotor con DNI 12345678A ha solicitado la licencia y el arquitecto X1234567Z también.';
    const result = stripPII(input);
    expect(result).toBe('El promotor con DNI [DNI/NIE] ha solicitado la licencia y el arquitecto [DNI/NIE] también.');
  });

  it('should remove Spanish phone numbers', () => {
    const input = 'Llámame al 600123456 o al +34 611 22 33 44.';
    const result = stripPII(input);
    expect(result).toBe('Llámame al [TELÉFONO] o al [TELÉFONO].');
  });

  it('should preserve regular text that looks similar but is not PII', () => {
    const input = 'El artículo 1234567 de la ley aplica al caso A.';
    const result = stripPII(input);
    expect(result).toBe('El artículo 1234567 de la ley aplica al caso A.');
  });

  it('should handle empty or null inputs', () => {
    expect(stripPII('')).toBe('');
    expect(stripPII(null as unknown as string)).toBe(null);
  });
});
