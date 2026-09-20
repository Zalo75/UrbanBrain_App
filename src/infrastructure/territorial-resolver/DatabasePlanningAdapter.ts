import { and, eq } from 'drizzle-orm'

import type { PlanningApplicability, PlanningPort, PlanningDocumentReference } from '@/domain/territorial-resolver/types'
import { db } from '@/infrastructure/db/client'
import { municipalPlanning } from '@/infrastructure/db/schema'
import {
  getActiveP1PlanningKnowledge,
  getPlanningDocumentsByInstrument,
} from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase'
import { SiotugaPlanningKnowledgeSource } from '@/infrastructure/planning-knowledge/SiotugaPlanningKnowledgeSource'
import type { PlanningInstrumentKnowledge } from '@/domain/planning-knowledge/types'
import { v2PilotConfigFromEnv } from '@/application/knowledge-engine/municipalRetrievalMode'
import { loadDynamicInstrumentIdentityCandidates } from '@/infrastructure/planning-knowledge/dynamicInstrumentIdentityCatalog'
import { enrichPlanningDocumentPreviews } from '@/infrastructure/planning-knowledge/documentPreviewLoader'

function dateKey(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return typeof value === 'string' && value.trim() ? value.slice(0, 10) : undefined
}

function sameDate(left?: unknown, right?: unknown) {
  const leftKey = dateKey(left)
  const rightKey = dateKey(right)
  return Boolean(leftKey && rightKey && leftKey === rightKey)
}

export function selectDynamicGeneralInstrument(
  instruments: readonly PlanningInstrumentKnowledge[],
  planningApprovalDate?: unknown,
) {
  const general = instruments.filter((candidate) => candidate.kind === 'general')
  return general.find((candidate) => sameDate(candidate.approvalDate, planningApprovalDate)) ?? general[0]
}

export function selectUniquePilotGeneralInstrument(
  instruments: readonly PlanningInstrumentKnowledge[],
  planningApprovalDate?: unknown,
) {
  const general = instruments.filter((candidate) => candidate.kind === 'general')
  const dated = general.filter((candidate) => sameDate(candidate.approvalDate, planningApprovalDate))
  if (dated.length === 1) return dated[0]
  return general.length === 1 ? general[0] : undefined
}

function instrumentReference(
  instrument: {
    officialId: string
    name: string
    kind: string
    approvalDate?: string
    sourceId: string
  },
  sourceUrl: string,
) {
  return {
    id: instrument.officialId,
    name: instrument.name,
    kind: instrument.kind,
    status: 'current' as const,
    approvalDate: instrument.approvalDate,
    sourceUrl,
  }
}

type DynamicPlanningDiscovery = Awaited<ReturnType<SiotugaPlanningKnowledgeSource['collectMunicipality']>>

/**
 * Builds the planning base from the official SIOTUGA inventory without
 * promoting modifications or derived instruments.  This is intentionally
 * independent from the V2 retrieval pilot flag: it establishes the municipal
 * planning identity used by every downstream resolver.
 */
export function buildDynamicBasePlanningResult(
  municipalityCode: string,
  discovered: DynamicPlanningDiscovery,
  retrievedAt = new Date().toISOString(),
): PlanningApplicability {
  const discoverySourceUrl = `https://siotuga.xunta.gal/siotuga/ws?codine=${municipalityCode}&SERVICE=WFS&REQUEST=GetCapabilities`
  const selected = selectUniquePilotGeneralInstrument(discovered.inventory, undefined)
  if (!selected) {
    return {
      status: 'not_determined',
      evidence: [],
      warnings: [{
        code: 'planning_dynamic_base_ambiguous',
        message: 'El inventario oficial SIOTUGA no contiene un único instrumento general determinable.',
      }],
    }
  }

  const documents = discovered.normativeDocuments
    .filter((document) => document.instrumentId === selected.officialId)
    .map((document): PlanningDocumentReference => ({
      id: document.officialDocumentId,
      instrumentId: document.instrumentId,
      title: document.name,
      sourceUrl: document.officialUrl,
      binding: 'general',
      documentType: document.documentType,
  }))
  if (documents.length === 0) {
    return {
      status: 'not_determined',
      evidence: [],
      warnings: [{
        code: 'planning_dynamic_documents_missing',
        message: 'El instrumento general oficial no tiene documentos normativos recuperables.',
      }],
    }
  }

  return {
    status: 'determined',
    instrument: selected.name,
    approvalDate: selected.approvalDate,
    sourceUrl: discoverySourceUrl,
    applicableInstruments: [instrumentReference(selected, discoverySourceUrl)],
    documents,
    canAnswerConcreteParameters: true,
    evidence: [{
      source: 'siotuga',
      sourceUrl: discoverySourceUrl,
      retrievedAt,
      method: `Descubrimiento dinámico SIOTUGA; instrumento matriz ${selected.officialId}`,
      scope: 'planning_instrument',
    }],
    warnings: [],
  }
}

export function buildApplicablePlanningQuery(database: typeof db, municipalityCode: string) {
  return database
    .select({
      name: municipalPlanning.name,
      approvalDate: municipalPlanning.approvalDate,
      sourceSystem: municipalPlanning.sourceSystem,
      sourceUrl: municipalPlanning.sourceUrl,
      sourceDocumentId: municipalPlanning.sourceDocumentId,
    })
    .from(municipalPlanning)
    .where(
      and(
        eq(municipalPlanning.municipalityId, municipalityCode),
        eq(municipalPlanning.status, 'vigente')
      )
    )
    .limit(2)
}

export class DatabasePlanningAdapter implements PlanningPort {
  async findApplicablePlanning(location: {
    municipalityCode?: string
  }): Promise<PlanningApplicability> {
    const startedAt = Date.now()
    const municipalityCode = location.municipalityCode
    console.log('UB-DIAG planning-start', JSON.stringify({ municipalityCode: municipalityCode ?? null, hasCoordinates: Boolean((location as { coordinates?: unknown }).coordinates), hasGeometry: Boolean((location as { geometry?: unknown }).geometry) }))
    if (!municipalityCode) {
      console.log('UB-DIAG planning-result', JSON.stringify({ municipalityCode: null, status: 'not_determined', reason: 'municipality_code_missing', durationMs: Date.now() - startedAt }))
      return {
        status: 'not_determined',
        evidence: [],
        warnings: [
          {
            code: 'municipality_code_missing',
            message: 'No existe código INE oficial para consultar el planeamiento.',
          },
        ],
      }
    }

    const knowledge = getActiveP1PlanningKnowledge(municipalityCode)
    if (knowledge) {
      let documents = [...knowledge.documents]
      if (process.env.NODE_ENV !== 'test') try {
        const collected = await new SiotugaPlanningKnowledgeSource().collectInstrumentDocuments(
          municipalityCode,
          knowledge.instrument.officialId,
          new Date().toISOString(),
        )
        const dynamicDocuments = collected.documents
          .filter((document) => document.instrumentId === knowledge.instrument.officialId)
          .map((document): PlanningDocumentReference => ({
            id: document.officialDocumentId,
            instrumentId: document.instrumentId,
            title: document.name,
            sourceUrl: document.officialUrl,
            binding: 'general',
            documentType: document.documentType,
          }))
        documents = [...new Map([...documents, ...dynamicDocuments].map((document) => [document.sourceUrl, document])).values()]
      } catch (error) {
        console.error('Failed to enrich P1 planning documents dynamically:', error)
      }
      documents = await enrichPlanningDocumentPreviews(documents, municipalityCode, knowledge.instrument.officialId)
      const ordinanceCandidates = await loadDynamicInstrumentIdentityCandidates(
        municipalityCode,
        knowledge.instrument.officialId,
        documents.map((document) => document.sourceUrl.split('/').pop() ?? '').filter(Boolean),
      )
      console.log('UB-DIAG planning-result', JSON.stringify({ municipalityCode, source: 'knowledge_base', status: 'determined', instrumentId: knowledge.instrument.officialId, documentCount: documents.length, candidateCount: ordinanceCandidates.length, durationMs: Date.now() - startedAt }))
      return {
        status: 'determined',
        instrument: knowledge.instrument.name,
        approvalDate: knowledge.instrument.approvalDate,
        sourceUrl: knowledge.instrument.inventoryUrl,
        applicableInstruments: [
          {
            id: knowledge.instrument.officialId,
            name: knowledge.instrument.name,
            kind: 'general',
            status: 'current',
            approvalDate: knowledge.instrument.approvalDate,
            sourceUrl: knowledge.instrument.inventoryUrl,
          },
        ],
        documents,
        ordinanceCandidates: ordinanceCandidates.length > 0 ? ordinanceCandidates : undefined,
        canAnswerConcreteParameters: documents.length > 0,
        evidence: [
          {
            source: 'siotuga',
            sourceUrl: knowledge.instrument.inventoryUrl,
            retrievedAt: knowledge.activation.verifiedAt,
            method: `Planning Knowledge Base ${knowledge.knowledgeVersion}; inventario documental ${knowledge.documentCatalog.sourceSha256}`,
            scope: 'planning_instrument',
          },
        ],
        warnings: [],
      }
    }

    const pilotConfig = v2PilotConfigFromEnv()
    if (pilotConfig.enabled && pilotConfig.allowedMunicipalityCodes.includes(municipalityCode)) {
      try {
        const source = new SiotugaPlanningKnowledgeSource()
        const discoverySourceUrl = `https://siotuga.xunta.gal/siotuga/ws?codine=${municipalityCode}&SERVICE=WFS&REQUEST=GetCapabilities`
        const discovered = await source.collectMunicipality(municipalityCode, new Date().toISOString())
        const selected = selectUniquePilotGeneralInstrument(discovered.inventory, undefined)
        if (!selected) {
          return {
            status: 'not_determined',
            evidence: [],
            warnings: [{ code: 'planning_pilot_instrument_ambiguous', message: 'El inventario SIOTUGA del piloto no contiene un único instrumento general determinable.' }],
          }
        }
        const documents = discovered.normativeDocuments
          .filter((document) => document.instrumentId === selected.officialId)
          .map((document): PlanningDocumentReference => ({
            id: document.officialDocumentId,
            instrumentId: document.instrumentId,
            title: document.name,
            sourceUrl: document.officialUrl,
            binding: 'general',
            documentType: document.documentType,
          }))
        if (documents.length === 0) {
          return {
            status: 'not_determined',
            evidence: [],
            warnings: [{ code: 'planning_pilot_documents_missing', message: 'El instrumento SIOTUGA del piloto no tiene documentos normativos recuperables.' }],
          }
        }
        return {
          status: 'determined',
          instrument: selected.name,
          approvalDate: selected.approvalDate,
          sourceUrl: discoverySourceUrl,
          applicableInstruments: [instrumentReference(selected, discoverySourceUrl)],
          documents,
          canAnswerConcreteParameters: true,
          evidence: [{
            source: 'siotuga',
            sourceUrl: discoverySourceUrl,
            retrievedAt: new Date().toISOString(),
            method: `Descubrimiento SIOTUGA V2 pilot; instrumento ${selected.officialId}`,
            scope: 'planning_instrument',
          }],
          warnings: [],
        }
      } catch (error) {
        console.error('Failed to discover SIOTUGA V2 pilot instrument dynamically:', error)
      }
    }

    const rows = await buildApplicablePlanningQuery(db, municipalityCode)

    const sourced = rows.filter((row) => row.sourceUrl)
    console.log('UB-DIAG planning-candidates', JSON.stringify({ municipalityCode, totalRows: rows.length, sourcedCount: sourced.length, candidates: sourced.map((row) => ({ source: row.sourceSystem, instrumentId: row.sourceDocumentId ?? null, name: row.name })) }))
    if (sourced.length === 0) {
      // A missing municipal_planning row must not prevent discovery of an
      // official base plan.  Resolve only a unique general instrument; keep
      // modifications/derived plans as discovery evidence and leave them for
      // parcel-level zoning resolution.
      try {
        const source = new SiotugaPlanningKnowledgeSource()
        const discovered = await source.collectMunicipality(
          municipalityCode,
          new Date().toISOString(),
        )
        const result = buildDynamicBasePlanningResult(municipalityCode, discovered)
        console.log('UB-DIAG planning-result', JSON.stringify({ municipalityCode, source: 'siotuga_dynamic', status: result.status, instrumentId: result.applicableInstruments?.[0]?.id ?? null, documentCount: result.documents?.length ?? 0, reason: result.warnings?.map((warning) => warning.code) ?? [], durationMs: Date.now() - startedAt }))
        return result
      } catch (error) {
        console.error('Failed to discover SIOTUGA base planning dynamically:', error)
      }
    }
    if (sourced.length !== 1) {
      console.log('UB-DIAG planning-result', JSON.stringify({ municipalityCode, status: 'not_determined', reason: sourced.length > 1 ? 'planning_conflict' : 'planning_not_catalogued', sourcedCount: sourced.length, durationMs: Date.now() - startedAt }))
      return {
        status: 'not_determined',
        evidence: [],
        warnings: [
          {
            code: sourced.length > 1 ? 'planning_conflict' : 'planning_not_catalogued',
            message:
              sourced.length > 1
                ? 'Hay varios instrumentos catalogados y no se puede elegir uno automáticamente.'
                : 'No hay un instrumento vigente y trazable catalogado para este municipio.',
          },
        ],
      }
    }

    const planning = sourced[0]
    let instrumentId = planning.sourceDocumentId ?? undefined
    let dynamicDiscovery: Awaited<ReturnType<SiotugaPlanningKnowledgeSource['collectMunicipality']>> | undefined
    let discoveredInstrument: (Awaited<ReturnType<SiotugaPlanningKnowledgeSource['collectMunicipality']>>['inventory'][number]) | undefined

    // SIOTUGA is the authority for its own document inventory. The generated
    // catalog remains available for non-SIOTUGA sources, but it must not be
    // required to resolve an official SIOTUGA instrument.
    let documents: PlanningDocumentReference[] = planning.sourceSystem === 'SIOTUGA'
      ? []
      : [...getPlanningDocumentsByInstrument(instrumentId)]

    // The municipal table is deliberately not the authority for SIOTUGA
    // instrument identity. When its source_document_id is absent, use the
    // existing official inventory discovery and select the general instrument
    // matching the current planning record. Modifications are discovered and
    // retained as evidence by the source, but are not promoted globally.
    if (!instrumentId && planning.sourceSystem === 'SIOTUGA') {
      try {
        const source = new SiotugaPlanningKnowledgeSource()
        dynamicDiscovery = await source.collectMunicipality(
          municipalityCode,
          new Date().toISOString(),
        )
        const selected = selectDynamicGeneralInstrument(
          dynamicDiscovery.inventory,
          planning.approvalDate,
        )
        discoveredInstrument = selected
        instrumentId = selected?.officialId
        documents = dynamicDiscovery.normativeDocuments
          .filter((document) => document.instrumentId === instrumentId)
          .map((document): PlanningDocumentReference => ({
            id: document.officialDocumentId,
            instrumentId: document.instrumentId,
            title: document.name,
            sourceUrl: document.officialUrl,
            binding: 'general',
            documentType: document.documentType,
          }))
      } catch (err) {
        console.error('Failed to discover SIOTUGA instrument dynamically:', err)
      }
    }

    // Fallback: fetch dynamically from SIOTUGA if no catalog is available but instrument is known
    if (documents.length === 0 && instrumentId && planning.sourceSystem === 'SIOTUGA') {
      try {
        const source = new SiotugaPlanningKnowledgeSource()
        const collected = await source.collectInstrumentDocuments(
          municipalityCode,
          instrumentId,
          new Date().toISOString()
        )
        documents = collected.documents.map((doc): PlanningDocumentReference => ({
          id: doc.officialDocumentId,
          instrumentId: doc.instrumentId,
          title: doc.name,
          sourceUrl: doc.officialUrl,
          binding: 'general',
          documentType: doc.documentType,
        }))
      } catch (err) {
        console.error('Failed to dynamically fetch SIOTUGA documents:', err)
      }
    }

    documents = await enrichPlanningDocumentPreviews(documents, municipalityCode, instrumentId)
    const ordinanceCandidates = planning.sourceSystem === 'SIOTUGA'
      ? await loadDynamicInstrumentIdentityCandidates(municipalityCode, instrumentId, documents.map((document) => document.sourceUrl.split('/').pop() ?? '').filter(Boolean))
      : []

    const result: PlanningApplicability = {
      status: 'determined',
      instrument: planning.name,
      approvalDate: dateKey(planning.approvalDate),
      sourceUrl: planning.sourceUrl ?? undefined,
      applicableInstruments: instrumentId
        ? [discoveredInstrument
            ? instrumentReference(discoveredInstrument, planning.sourceUrl ?? '')
            : {
                id: instrumentId,
                name: planning.name,
                kind: 'general',
                status: 'current' as const,
                approvalDate: dateKey(planning.approvalDate),
                sourceUrl: planning.sourceUrl ?? '',
              }]
        : undefined,
      documents: documents.length > 0 ? documents : undefined,
      ordinanceCandidates: ordinanceCandidates.length > 0 ? ordinanceCandidates : undefined,
      canAnswerConcreteParameters: documents.length > 0,
      evidence: [
        {
          source: planning.sourceSystem === 'SIOTUGA' ? 'siotuga' : 'urbanbrain',
          sourceUrl: planning.sourceUrl ?? '',
          retrievedAt: new Date().toISOString(),
          method: dynamicDiscovery
            ? `Descubrimiento dinámico SIOTUGA; instrumento ${instrumentId}`
            : 'Búsqueda dinámica en inventario municipal',
          scope: 'planning_instrument',
        },
      ],
      warnings: [],
    }
    console.log('UB-DIAG planning-result', JSON.stringify({ municipalityCode, source: planning.sourceSystem, status: result.status, instrumentId: instrumentId ?? null, documentCount: documents.length, candidateCount: ordinanceCandidates.length, durationMs: Date.now() - startedAt }))
    return result
  }
}
