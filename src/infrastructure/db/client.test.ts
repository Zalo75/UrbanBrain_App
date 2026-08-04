import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  postgres: vi.fn(() => ({ kind: 'postgres-client' })),
  drizzle: vi.fn(() => ({ kind: 'drizzle-database' })),
}))

vi.mock('postgres', () => ({ default: mocks.postgres }))
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: mocks.drizzle }))

const databaseGlobals = globalThis as typeof globalThis & {
  __urbanbrainPostgresClient?: unknown
  __urbanbrainDrizzleDatabase?: unknown
}

describe('database client lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost:5432/test')
    vi.stubEnv('NODE_ENV', 'development')
    delete databaseGlobals.__urbanbrainPostgresClient
    delete databaseGlobals.__urbanbrainDrizzleDatabase
  })

  it('reuses the same postgres and drizzle instances across development module reloads', async () => {
    const first = await import('./client')
    vi.resetModules()
    const second = await import('./client')

    expect(second.client).toBe(first.client)
    expect(second.db).toBe(first.db)
    expect(mocks.postgres).toHaveBeenCalledTimes(1)
    expect(mocks.drizzle).toHaveBeenCalledTimes(1)
  })

  it('uses one connection outside production instead of the postgres.js default', async () => {
    await import('./client')

    expect(mocks.postgres).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        prepare: false,
        max: 1,
        idle_timeout: 20,
        connect_timeout: 10,
        max_lifetime: 60 * 30,
      })
    )
  })
})
