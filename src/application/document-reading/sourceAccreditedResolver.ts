import { db } from '@/infrastructure/db/client';
import { chatMessages, normativeChunksV2, normativaChunks } from '@/infrastructure/db/schema';
import { eq, desc } from 'drizzle-orm';
import { normalizeFragment } from '@/app/(dashboard)/expedientes/[id]/sourceClipboard';

export interface ResolvedAccreditedSource {
  sourceRef: string;
  documentName: string;
  originalCanonicalText: string;
  sourceLanguage?: string;
}

export async function resolveAccreditedSourceText(
  expedienteId: string,
  sourceRef: string
): Promise<ResolvedAccreditedSource | null> {
  if (!expedienteId || !sourceRef) {
    return null;
  }

  const normalizedTargetRef = sourceRef.trim();

  // 1. Check all chat messages for this expediente in reverse chronological order
  const messages = await db
    .select({
      role: chatMessages.role,
      sources: chatMessages.sources,
    })
    .from(chatMessages)
    .where(eq(chatMessages.expedienteId, expedienteId))
    .orderBy(desc(chatMessages.createdAt));

  for (const message of messages) {
    if (!message.sources) continue;

    let sourcesList: unknown[] = [];
    if (Array.isArray(message.sources)) {
      sourcesList = message.sources;
    } else if (typeof message.sources === 'string') {
      try {
        const parsed = JSON.parse(message.sources);
        if (Array.isArray(parsed)) sourcesList = parsed;
      } catch {
        continue;
      }
    }

    for (const rawSource of sourcesList) {
      if (!rawSource || typeof rawSource !== 'object') continue;
      const s = rawSource as Record<string, unknown>;
      const chunkId = typeof (s.chunk_id ?? s.chunkId ?? s.id) === 'string'
        ? String(s.chunk_id ?? s.chunkId ?? s.id)
        : '';
      const sourceIndex = typeof (s.source_index ?? s.sourceIndex) === 'number'
        ? String(s.source_index ?? s.sourceIndex)
        : '';

      const isMatch =
        chunkId === normalizedTargetRef ||
        (chunkId && chunkId.startsWith(normalizedTargetRef + ':')) ||
        (sourceIndex && sourceIndex === normalizedTargetRef) ||
        (sourceIndex && normalizedTargetRef.toLowerCase() === `fuente ${sourceIndex}`.toLowerCase()) ||
        (sourceIndex && normalizedTargetRef.toLowerCase() === `[fuente ${sourceIndex}]`.toLowerCase()) ||
        (normalizedTargetRef.startsWith('fuente ') && sourceIndex === normalizedTargetRef.replace('fuente ', '').trim());

      if (isMatch) {
        const rawContent =
          s.fragmento_completo ??
          s.fragmentoCompleto ??
          s.content ??
          s.texto ??
          s.text ??
          s.fragmento ??
          s.fragmento_corto ??
          s.fragment;

        const normalized = normalizeFragment(rawContent);
        if (normalized) {
          return {
            sourceRef: chunkId || normalizedTargetRef,
            documentName: typeof (s.nombre_pdf ?? s.documentName ?? s.title) === 'string'
              ? String(s.nombre_pdf ?? s.documentName ?? s.title)
              : 'Documento acreditado',
            originalCanonicalText: normalized,
          };
        }
      }
    }
  }

  // 2. Fallback for instrument-document:docId:chunk:chunkId if not found in chat history
  const chunkMatch = /^instrument-document:[^:]+:chunk:(.+)$/.exec(normalizedTargetRef);
  if (chunkMatch) {
    const chunkId = chunkMatch[1];
    // Try V2 corpus
    const v2Result = await db
      .select({
        content: normativeChunksV2.content,
      })
      .from(normativeChunksV2)
      .where(eq(normativeChunksV2.id, chunkId))
      .limit(1);

    if (v2Result.length > 0 && v2Result[0].content) {
      const normalized = normalizeFragment(v2Result[0].content);
      if (normalized) {
        return {
          sourceRef: normalizedTargetRef,
          documentName: 'Documento normativo oficial',
          originalCanonicalText: normalized,
        };
      }
    }

    // Try V1 corpus
    const v1Result = await db
      .select({
        content: normativaChunks.content,
      })
      .from(normativaChunks)
      .where(eq(normativaChunks.id, chunkId))
      .limit(1);

    if (v1Result.length > 0 && v1Result[0].content) {
      const normalized = normalizeFragment(v1Result[0].content);
      if (normalized) {
        return {
          sourceRef: normalizedTargetRef,
          documentName: 'Documento normativo oficial',
          originalCanonicalText: normalized,
        };
      }
    }
  }

  // FAIL CLOSED: No accredited source matched
  return null;
}
