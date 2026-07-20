import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('new expediente Server Actions module', () => {
  it('exports no runtime value other than async functions', async () => {
    const source = await readFile(
      resolve(process.cwd(), 'src/app/(dashboard)/expedientes/new/actions.ts'),
      'utf8'
    )

    expect(source).toMatch(/^['\"]use server['\"]/m)
    const runtimeExports = [...source.matchAll(/^export\s+(?!type\b|interface\b)(.+)$/gm)].map(
      (match) => match[1].trim()
    )

    expect(runtimeExports).toEqual([
      'async function createExpediente(',
      'async function detectContextAction(formData: FormData) {',
      'async function getPlanningOptionsAction(municipalityId: string) {',
    ])
  })
})
