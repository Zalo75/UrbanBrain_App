import 'dotenv/config'

import { Client } from 'pg'

import {
  addSimulationRow,
  buildChunkCompactionSimulationReport,
  createChunkCompactionSimulationState,
  createSimulationPageRequest,
  normalizeSimulationOptions,
  READ_ONLY_TRANSACTION_SQL,
  type NormativaChunkSimulationRow,
} from '../src/application/document-processing/chunkCompactionSimulation'

function argumentValue(name: string) {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function optionalInteger(name: string) {
  const value = argumentValue(name)
  if (value === undefined) return undefined
  if (!/^\d+$/u.test(value)) throw new Error(`${name} requires a positive integer`)
  return Number(value)
}

async function run() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const options = normalizeSimulationOptions({
    batchSize: optionalInteger('--batch-size'),
    limit: optionalInteger('--limit'),
  })
  const client = new Client({
    connectionString,
    application_name: 'urbanbrain_rag_compaction_read_only',
    statement_timeout: 15_000,
    query_timeout: 20_000,
  })
  const state = createChunkCompactionSimulationState()
  let lastId: string | undefined

  await client.connect()
  try {
    await client.query(READ_ONLY_TRANSACTION_SQL)
    while (true) {
      const request = createSimulationPageRequest(options, state.totalRows, lastId)
      if (!request) break

      const result = await client.query<NormativaChunkSimulationRow>(
        request.sql,
        request.params
      )
      if (result.rows.length === 0) break

      for (const row of result.rows) addSimulationRow(state, row)
      lastId = result.rows.at(-1)?.id
      if (result.rows.length < request.pageSize) break
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }

  process.stdout.write(`${JSON.stringify(buildChunkCompactionSimulationReport(state), null, 2)}\n`)
}

run().catch((error: unknown) => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'SIMULATION_FAILED'
  process.stderr.write(`La simulacion de solo lectura no pudo completarse (${code}).\n`)
  process.exitCode = 1
})
