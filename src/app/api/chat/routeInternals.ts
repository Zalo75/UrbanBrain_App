import type { NormativeRegimeIdentity, NormativeCandidate } from '@/domain/parcel-context/types'
import type { NormativeSearchScope } from '@/application/parcel-context/normativeSearchScope'
import type { InstrumentIdentity, InstrumentIdentityCatalog } from '@/domain/planning-knowledge/identityCatalog'

export const EXACT_CHUNK_SELECT = 'chunk_id,municipio_nombre,nombre_pdf,titulo_detectado,ruta_pdf,texto,metadata,embedding'

export type ChatNormativeCandidate = NormativeCandidate & { visibleSourceKind?: 'normative_v1' | 'normative_v2' }

export function hasSpecificNormativeEvidence(candidates: ChatNormativeCandidate[], scope?: NormativeSearchScope) {
  if (!scope?.identityId || !scope.instrumentId) return false
  return candidates.some((candidate) =>
    candidate.evidenceSpecificity !== 'NON_SPECIFIC' &&
    candidate.parentInstrument === scope.instrumentId &&
    candidate.identityId === scope.identityId &&
    candidate.normativeReferences?.some((reference) => reference.chunkIds.includes(candidate.id)) === true
  )
}

export function resolveNormativeCandidateProvenance(
  ownRegime: NormativeRegimeIdentity | null | undefined,
  scope: Pick<NormativeSearchScope, 'identityId' | 'normativeReferences'> | undefined,
  inheritCanonicalIdentity: boolean,
) {
  return {
    ordinance: ownRegime?.kind === 'ordinance' ? ownRegime.code ?? null : null,
    planningArea: ownRegime?.kind === 'planning_area' ? ownRegime.code ?? null : null,
    identityId: inheritCanonicalIdentity ? scope?.identityId ?? null : null,
    normativeReferences: inheritCanonicalIdentity ? scope?.normativeReferences : undefined,
  }
}

function containsMention(text: string, value: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Z0-9ÁÉÍÓÚÑ])${escaped}(?=$|[^A-Z0-9ÁÉÍÓÚÑ])`, 'i').test(text)
}

export function resolveMentionedAcceptedIdentities(
  text: string,
  catalog?: InstrumentIdentityCatalog,
) {
  if (!catalog) return []
  const matches = catalog.identities.filter((identity): identity is InstrumentIdentity =>
    identity.status === 'ACCEPTED' &&
    (identity.semanticDimension === 'ordinance' || identity.semanticDimension === 'zoning') &&
    (containsMention(text, identity.officialCode) || containsMention(text, identity.officialName))
  )
  return [...new Map(matches.map((identity) => [identity.id, identity])).values()]
}

/**
 * A canonical identity is the default boundary for directed retrieval. Widen
 * only when the question or the reasoner's missing facts explicitly require
 * another identity or a cross-zone rule.
 */
export function shouldWidenDirectedNormativeScope(
  question: string,
  missingFacts: string[],
  authoritativeIdentity?: string | null,
) {
  if (!authoritativeIdentity?.trim()) return true

  const text = `${question}\n${missingFacts.join('\n')}`
  const identityCodes = text.match(/\b[A-ZÁÉÍÓÚÑ]{1,10}(?:[-/]\d{1,4})\b/gi) ?? []
  const normalizedIdentity = authoritativeIdentity.trim().toLocaleUpperCase()
  if (identityCodes.some((code) => code.toLocaleUpperCase() !== normalizedIdentity)) return true

  return /\b(?:otra(?:s)?\s+(?:ordenanza|zona|identidad)|dos\s+zonas?|varias\s+zonas?|entre\s+zonas?|atrav(?:iesa|iesan)|compatibilidad\s+entre|coexistencia|intersecci[oó]n|sub[áa]mbito|ambos|ambas)\b/i.test(text)
}

export type { NormativeRegimeIdentity }
