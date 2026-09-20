import { createHash } from 'node:crypto';

export function normalizeSourceTextForHashing(rawText: string): string {
  return rawText.normalize('NFC').trim();
}

export function computeSourceHash(rawText: string): string {
  const normalized = normalizeSourceTextForHashing(rawText);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
