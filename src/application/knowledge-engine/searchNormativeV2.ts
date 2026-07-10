import { db } from '../../infrastructure/db/client';
import { normativeDocumentsV2, normativeChunksV2 } from '../../infrastructure/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';

export interface SearchV2Params {
  query_embedding: number[];
  scopes: string[];
  categories: string[];
  municipalityId?: string;
  documentCodes?: string[];
  limit?: number;
}

export async function searchNormativeV2(params: SearchV2Params) {
  try {
    const { query_embedding, scopes = [], categories = [], municipalityId, limit = 8 } = params;

    let docFilters;

    if (process.env.KNOWLEDGE_V2_TEST_VERSION_ID) {
      // historical_test mode
      docFilters = [
        eq(normativeDocumentsV2.id, process.env.KNOWLEDGE_V2_TEST_VERSION_ID),
        eq(normativeDocumentsV2.legalReviewStatus, 'reviewed')
      ];
    } else {
      // current mode
      docFilters = [
        eq(normativeDocumentsV2.legalReviewStatus, 'reviewed'),
        eq(normativeDocumentsV2.isConsolidated, true),
        eq(normativeDocumentsV2.status, 'vigente'),
        eq(normativeDocumentsV2.currentVersion, true)
      ];
    }

    // Map legacy categories to V2 enums safely
    const validCategories = ["CTE", "NHG", "PXOM", "ordenanza", "urbanismo_general", "accesibilidad", "incendios"];
    const safeCategories = categories.map(c => c === 'habitabilidad' ? 'NHG' : c).filter(c => validCategories.includes(c));

    if (scopes.length > 0) {
      docFilters.push(inArray(normativeDocumentsV2.scopeType, scopes as any[]));
    }

    if (safeCategories.length > 0) {
      docFilters.push(inArray(normativeDocumentsV2.category, safeCategories as any[]));
    }

    if (municipalityId) {
      docFilters.push(eq(normativeDocumentsV2.municipalityId, municipalityId));
    }

    if (params.documentCodes && params.documentCodes.length > 0) {
      // Create ILIKE conditions for each DB code (e.g., 'DB-SI') on officialIdentifier
      const conditions = params.documentCodes.map(code => sql`${normativeDocumentsV2.officialIdentifier} ILIKE ${'%' + code + '%'}`);
      docFilters.push(sql`(${sql.join(conditions, sql` OR `)})`);
    }

    const embeddingString = `[${query_embedding.join(',')}]`;

    const results = await db.select({
      chunk_id: normativeChunksV2.id,
      document_id: normativeDocumentsV2.id,
      title: normativeDocumentsV2.title,
      version: normativeDocumentsV2.versionLabel,
      content: normativeChunksV2.content,
      similarity: sql<number>`1 - (${normativeChunksV2.embedding} <=> ${embeddingString}::vector)`.as('similarity'),
      scope: normativeDocumentsV2.scopeType,
      category: normativeDocumentsV2.category,
      page: normativeChunksV2.page,
      article: normativeChunksV2.article,
      chapter: normativeChunksV2.chapter,
      sourceUrl: normativeDocumentsV2.sourceUrl,
      officialIdentifier: normativeDocumentsV2.officialIdentifier
    })
    .from(normativeChunksV2)
    .innerJoin(normativeDocumentsV2, eq(normativeChunksV2.documentId, normativeDocumentsV2.id))
    .where(and(...docFilters))
    .orderBy(sql`${normativeChunksV2.embedding} <=> ${embeddingString}::vector`)
    .limit(limit);

    return results;
  } catch (error) {
    console.error("[Shadow V2] Error interno:", error);
    return [];
  }
}
