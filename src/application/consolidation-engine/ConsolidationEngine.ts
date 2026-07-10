import { db } from '../../infrastructure/db/client'
import { normativeDocumentsV2, legalUpdates, normativeChunksV2, normativeFamilies } from '../../infrastructure/db/schema'
import { eq, asc, and } from 'drizzle-orm'
import { ConsolidationRequest, ConsolidatedArtifact, ConsolidationConflict, SectionManifest } from '../../domain/consolidation-engine/types'
import { createHash } from 'crypto'

export class ConsolidationEngine {
  
  async generateCandidate(req: ConsolidationRequest): Promise<ConsolidatedArtifact> {
    const { normativeFamilyId, targetVersionId } = req

    // 1. Fetch family and target version
    const family = await db.select().from(normativeFamilies).where(eq(normativeFamilies.id, normativeFamilyId)).limit(1)
    if (!family.length) throw new Error('Family not found')

    const targetVersion = await db.select().from(normativeDocumentsV2).where(eq(normativeDocumentsV2.id, targetVersionId)).limit(1)
    if (!targetVersion.length) throw new Error('Target version not found')

    // 2. Fetch base version (the oldest one in the family)
    const baseVersions = await db.select()
      .from(normativeDocumentsV2)
      .where(eq(normativeDocumentsV2.normativeFamilyId, normativeFamilyId))
      .orderBy(asc(normativeDocumentsV2.validFrom))
      .limit(1)
    
    if (!baseVersions.length) throw new Error('No base version found')
    const baseVersion = baseVersions[0]

    // 3. Fetch all legal updates for this family to build the chain
    // Realistically we'd traverse from base to target using source/target IDs.
    const allUpdates = await db.select()
      .from(legalUpdates)
      .innerJoin(normativeDocumentsV2, eq(legalUpdates.sourceVersionId, normativeDocumentsV2.id))
      .where(eq(normativeDocumentsV2.normativeFamilyId, normativeFamilyId))
      .orderBy(asc(legalUpdates.consolidationOrder))

    // 4. Filter the chain up to targetVersionId
    const chain = []
    let currentId = baseVersion.id
    for (const row of allUpdates) {
      if (row.legal_updates.sourceVersionId === currentId) {
        chain.push(row.legal_updates)
        currentId = row.legal_updates.targetVersionId!
        if (row.legal_updates.targetVersionId === targetVersionId) {
          break;
        }
      }
    }

    // Validation
    const conflicts: ConsolidationConflict[] = []
    for (const update of chain) {
      if (!update.sourceUrl) conflicts.push({ updateId: update.id, affectedSection: update.affectedSection, reason: 'Missing source_url' })
      if (!update.sourceHash) conflicts.push({ updateId: update.id, affectedSection: update.affectedSection, reason: 'Missing source_hash' })
      if (!update.affectedSection) conflicts.push({ updateId: update.id, affectedSection: update.affectedSection ?? 'Unknown', reason: 'Missing affected_section' })
      if (!update.replacementText) conflicts.push({ updateId: update.id, affectedSection: update.affectedSection, reason: 'Missing replacement_text' })
    }

    // 5. Fetch base text (from chunks)
    const baseChunks = await db.select()
      .from(normativeChunksV2)
      .where(eq(normativeChunksV2.documentId, baseVersion.id))
      .orderBy(asc(normativeChunksV2.chunkIndex))
    
    let consolidatedText = baseChunks.map(c => c.content).join('\n\n')
    const sectionsManifest: SectionManifest[] = []

    // 6. Apply modifications in order
    for (const update of chain) {
      // If we have conflicts related to validation, skip
      if (conflicts.some(c => c.updateId === update.id)) continue;

      let applied = false;

      // Try unequivocal replacement
      if (update.previousText && consolidatedText.includes(update.previousText)) {
        consolidatedText = consolidatedText.replace(update.previousText, update.replacementText)
        applied = true;
      } else {
        // We cannot locate it unequivocally. 
        conflicts.push({
          updateId: update.id,
          affectedSection: update.affectedSection,
          reason: 'Cannot locate unequivocally: ' + (update.previousText ? 'previousText not found' : 'previousText is null')
        })
      }

      sectionsManifest.push({
        section: update.affectedSection,
        baseText: update.previousText || 'NOT_FOUND',
        appliedModification: update.replacementText,
        officialSource: update.officialPublication,
        effectiveDate: update.effectiveDate || update.publicationDate,
        sourceHash: update.sourceHash
      })
    }

    // 7. Generate artifacts
    const mdHeader = `---
title: ${family[0].name}
version: ${targetVersion[0].versionLabel}
consolidation_date: ${new Date().toISOString()}
status: CANDIDATO NO REVISADO
official_sources: ${chain.map(u => u.officialPublication).join(', ')}
---

`
    const finalMarkdown = mdHeader + consolidatedText
    const hash = createHash('sha256').update(finalMarkdown).digest('hex')
    
    // Insert hash into header
    const finalMarkdownWithHash = finalMarkdown.replace('---\n\n', `hash: ${hash}\n---\n\n`)

    const manifest = {
      familyId: normativeFamilyId,
      targetVersionId,
      baseVersionId: baseVersion.id,
      consolidationDate: new Date(),
      sections: sectionsManifest
    }

    return {
      markdown: finalMarkdownWithHash,
      manifest,
      conflicts,
      hash,
      hasConflicts: conflicts.length > 0
    }
  }
}
