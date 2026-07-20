import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import dotenv from 'dotenv'
import postgres from 'postgres'
import { createSnapshot, diffSnapshots, SIOTUGA_CORUNA_URL } from '../src/application/municipal-planning-import/corunaPlanningImport'

const args = process.argv.slice(2); const value = (name: string) => args[args.indexOf(name) + 1]
const source = value('--source'); const output = value('--snapshot-dir') ?? '.artifacts/municipal-planning-coruna'
if (!source) throw new Error('Provide --source <SIOTUGA HTML>.')
const html = await readFile(resolve(source), 'utf8'); const snapshot = createSnapshot(html, new Date().toISOString())
const previousPath = value('--previous-snapshot'); const previous = previousPath ? JSON.parse(await readFile(resolve(previousPath), 'utf8')) : undefined
const apply = args.includes('--apply')
if (apply) {
  dotenv.config({ path: resolve('.env') })
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required only with --apply.')
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
  try {
    await sql.begin(async (tx) => {
      const existing = await tx`select id, municipality_id, external_id, status from public.municipal_planning where province_id = 'a_coruna'`
      for (const candidate of snapshot.records) {
        const active = existing.filter((row) => row.municipality_id === candidate.municipalityId && row.status === 'vigente')
        if (active.length > 1) throw new Error(`Database import blocked: ${candidate.municipalityId} has multiple vigente records`)
        if (active[0]?.external_id === candidate.externalId) continue
        if (active[0]) await tx`update public.municipal_planning set status = 'derogado', valid_to = now() where id = ${active[0].id}`
        await tx`insert into public.municipal_planning (province_id, municipality_id, name, status, approval_date, source_system, source_url, external_id, notes) values ('a_coruna', ${candidate.municipalityId}, ${candidate.name}, 'vigente', ${candidate.approvalDate}, 'SIOTUGA', ${candidate.sourceUrl}, ${candidate.externalId}, ${candidate.adaptation ?? null})`
      }
    })
  } finally { await sql.end({ timeout: 5 }) }
}
const report = { snapshot, diff: diffSnapshots(previous, snapshot), mode: apply ? 'apply' : 'dry-run' }
await mkdir(resolve(output), { recursive: true }); await writeFile(resolve(output, 'snapshot.json'), JSON.stringify(snapshot, null, 2)); await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ source: SIOTUGA_CORUNA_URL, candidates: snapshot.records.length, changes: report.diff.reduce((acc, item) => ({ ...acc, [item.change]: (acc[item.change] ?? 0) + 1 }), {} as Record<string, number>), mode: report.mode }))
