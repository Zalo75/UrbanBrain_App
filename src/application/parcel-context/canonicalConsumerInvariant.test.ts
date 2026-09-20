import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('invariantes de lectura canónica', () => {
  it('no permite que chat o Expediente pasen rawResponse al alcance operativo', () => {
    const route = source('src/app/api/chat/route.ts')
    const page = source('src/app/(dashboard)/expedientes/[id]/page.tsx')
    const scope = source('src/application/parcel-context/normativeSearchScope.ts')
    expect(route).not.toContain('rawDetection:')
    expect(page).not.toContain('rawResponse')
    expect(scope).not.toContain('rawDetection')
  })

  it('conserva la evidencia raw sólo en la frontera de repositorio/continuidad', () => {
    const repository = source('src/infrastructure/db/parcelContextRepository.ts')
    expect(repository).toContain('isVersionedSummary')
    expect(repository).toContain('rehydrateDetectionSummary(legacyDetected')
    expect(repository).toContain('legacyAuditRaw')
  })
})
