import 'dotenv/config'
import { db } from '../src/infrastructure/db/client'
import { normativeFamilies, normativeDocumentsV2 } from '../src/infrastructure/db/schema'
import { eq, and } from 'drizzle-orm'
import { ConsolidationEngine } from '../src/application/consolidation-engine/ConsolidationEngine'
import fs from 'fs'
import path from 'path'

async function run() {
  const family = await db.select().from(normativeFamilies).where(eq(normativeFamilies.code, 'NHG')).limit(1)
  if (!family.length) throw new Error('NHG Family not found')

  const targetVersionList = await db.select()
    .from(normativeDocumentsV2)
    .where(and(
      eq(normativeDocumentsV2.normativeFamilyId, family[0].id),
      eq(normativeDocumentsV2.currentVersion, true)
    )).limit(1)
  
  if (!targetVersionList.length) throw new Error('Target version not found')

  const engine = new ConsolidationEngine()
  console.log(`Generando candidato para: ${family[0].name} - ${targetVersionList[0].versionLabel}...`)
  
  const artifact = await engine.generateCandidate({
    normativeFamilyId: family[0].id,
    targetVersionId: targetVersionList[0].id
  })

  console.log('\n--- ACTUALIZACIONES APLICADAS ---')
  console.table(artifact.manifest.sections)

  console.log('\n--- CONFLICTOS ENCONTRADOS ---')
  if (artifact.conflicts.length > 0) {
    console.table(artifact.conflicts)
  } else {
    console.log('Ninguno. Consolidación perfecta.')
  }

  console.log('\n--- RESULTADO ---')
  console.log(`Aprobación automática: ${artifact.hasConflicts ? 'DENEGADA' : 'PERMITIDA'}`)
  console.log(`Hash SHA-256: ${artifact.hash}`)

  const outDir = path.join(__dirname, '..', 'corpus_v2', 'consolidated_candidates', 'NHG')
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  const mdPath = path.join(outDir, `candidato_${artifact.hash}.md`)
  const jsonPath = path.join(outDir, `manifest_${artifact.hash}.json`)
  const conflictPath = path.join(outDir, `conflicts_${artifact.hash}.json`)

  fs.writeFileSync(mdPath, artifact.markdown)
  fs.writeFileSync(jsonPath, JSON.stringify(artifact.manifest, null, 2))
  fs.writeFileSync(conflictPath, JSON.stringify(artifact.conflicts, null, 2))

  console.log('\n--- ARTEFACTOS GUARDADOS EN ---')
  console.log(`Markdown: ${mdPath}`)
  console.log(`Manifest: ${jsonPath}`)
  console.log(`Conflicts: ${conflictPath}`)

  process.exit(0)
}

run().catch(console.error)
