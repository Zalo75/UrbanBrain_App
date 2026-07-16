import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionSourceFiles(path)
    if (!['.ts', '.tsx'].includes(extname(entry.name)) || entry.name.includes('.test.')) return []
    return [path]
  })
}

const productionSource = productionSourceFiles(join(process.cwd(), 'src'))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

describe('private expedientes storage bucket', () => {
  it('does not expose files through public URLs or unauthorised browser downloads', () => {
    expect(productionSource).not.toMatch(/\bgetPublicUrl\s*\(/)
    expect(productionSource).not.toMatch(/\.storage\.from\(['"]expedientes['"]\)\.download\s*\(/)
  })

  it('uses only the server-authorized signed upload flow', () => {
    expect(productionSource).toMatch(/\.storage\.from\(['"]expedientes['"]\)\.createSignedUploadUrl\s*\(/)
    expect(productionSource).toMatch(/\.storage\.from\(['"]expedientes['"]\)\.uploadToSignedUrl\s*\(/)
  })
})
