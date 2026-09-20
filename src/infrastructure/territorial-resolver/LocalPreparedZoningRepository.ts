import fs from 'node:fs/promises'
import path from 'node:path'
import type { PreparedZoningLayer } from './preparedZoningLayer'
import type { PreparedZoningRepository } from './PreparedZoningStrategy'

export class LocalPreparedZoningRepository implements PreparedZoningRepository {
  constructor(private readonly baseDir: string = process.cwd()) {}

  async getLayer(municipalityCode: string, instrumentId: string): Promise<PreparedZoningLayer | null> {
    try {
      // Possible locations: local cache or artifacts
      const name = municipalityCode + '_' + instrumentId + '_prepared_zoning.json'
      const candidates = [
        path.join(this.baseDir, 'artifacts', name),
        path.join(this.baseDir, '..', 'UrbanBrain_Ingestion_V2', name),
      ]
      
      for (const file of candidates) {
        try {
          const content = await fs.readFile(file, 'utf8')
          return JSON.parse(content) as PreparedZoningLayer
        } catch {
          // ignore and try next
        }
      }
      return null
    } catch {
      return null
    }
  }
}
