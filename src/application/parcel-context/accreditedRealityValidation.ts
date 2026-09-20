import type { ApplicabilityResult, NormativeCandidate, ReasonerClaim } from '@/domain/parcel-context/types'
import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import { validateReasonerOutput, type ClaimValidationResult } from './responseSafety'
import type { AccreditedRealityReasonerClaim, AccreditedRealityReasonerOutput } from './accreditedRealityTool'

export interface AccreditedRealityClaimValidationResult {
  validClaims: AccreditedRealityReasonerClaim[]
  invalidClaimCount: number
  invalidClaimReasonCounts: Record<string, number>
  /** Stable source IDs, never array positions. */
  citations: string[]
  /** Internal compatibility projection used only by buildAnswerContract. */
  legacyCitations: number[]
}

function sourceIndexByReference(sources: NormativeCandidate[]) {
  const exact = new Map<string, number>()
  const aliases = new Map<string, number | null>()
  sources.forEach((source, index) => {
    exact.set(source.id, index + 1)
    for (const alias of source.sourceAliases ?? []) {
      if (!alias || exact.has(alias)) continue
      const previous = aliases.get(alias)
      aliases.set(alias, previous === undefined ? index + 1 : null)
    }
  })
  return { exact, aliases }
}

function resolveStableReference(reference: string, sources: NormativeCandidate[], indexes: ReturnType<typeof sourceIndexByReference>) {
  const exactIndex = indexes.exact.get(reference)
  if (exactIndex) return { index: exactIndex, id: sources[exactIndex - 1]!.id }
  const aliasIndex = indexes.aliases.get(reference)
  if (aliasIndex) return { index: aliasIndex, id: sources[aliasIndex - 1]!.id }
  return null
}

export function validateAccreditedRealityOutput(
  output: AccreditedRealityReasonerOutput,
  sources: NormativeCandidate[],
  applicability: ApplicabilityResult,
  context?: NormalizedParcelContext,
): AccreditedRealityClaimValidationResult {
  const indexes = sourceIndexByReference(sources)
  const stableByClaimId = new Map<string, AccreditedRealityReasonerClaim>()
  const mappedClaims: ReasonerClaim[] = []
  let preRejectedCount = 0
  let rejectedGraphicCount = 0

  for (const claim of output.claims) {
    if (claim.sourceRefs.some(ref => ref.startsWith('cartographic-view:')) && (claim.type !== 'limitation' || claim.appliesToParcel === true)) {
      rejectedGraphicCount++
      continue
    }
    const resolved = claim.sourceRefs.map((reference) => resolveStableReference(reference, sources, indexes))
    if (resolved.some((value) => value === null)) {
      preRejectedCount++
      continue
    }
    stableByClaimId.set(claim.id, claim)
    mappedClaims.push({
      ...claim,
      sourceRefs: resolved.map((value) => value!.index),
    })
  }

  const mappedOutput = { ...output, claims: mappedClaims }
  const legacy: ClaimValidationResult = validateReasonerOutput(mappedOutput, sources, applicability, context)
  const invalidClaimReasonCounts: Record<string, number> = { ...legacy.invalidClaimReasonCounts }
  if (preRejectedCount > 0) invalidClaimReasonCounts.NON_EXISTENT_SOURCE = (invalidClaimReasonCounts.NON_EXISTENT_SOURCE ?? 0) + preRejectedCount

  if (rejectedGraphicCount) invalidClaimReasonCounts.GRAPHIC_NOT_NORMATIVE_EVIDENCE = rejectedGraphicCount
  const validClaims = legacy.validClaims
    .map((claim) => stableByClaimId.get(claim.id))
    .filter((claim): claim is AccreditedRealityReasonerClaim => Boolean(claim))
    .map((claim) => ({
      ...claim,
      sourceRefs: claim.sourceRefs
        .map((reference) => resolveStableReference(reference, sources, indexes)?.id)
        .filter((id): id is string => Boolean(id)),
    }))
  const citations = Array.from(new Set(validClaims.flatMap((claim) => claim.sourceRefs.map((reference) => resolveStableReference(reference, sources, indexes)?.id).filter((id): id is string => Boolean(id)))))
  const legacyCitations = Array.from(new Set(legacy.validClaims.flatMap((claim) => claim.sourceRefs)))
  return {
    validClaims,
    invalidClaimCount: legacy.invalidClaimCount + preRejectedCount + rejectedGraphicCount,
    invalidClaimReasonCounts,
    citations,
    legacyCitations,
  }
}

export function renderAccreditedRealityClaimsNeutral(claims: AccreditedRealityReasonerClaim[]): string {
  return claims.map((claim) => {
    const refs = Array.from(new Set(claim.sourceRefs)).map((reference) => `[Fuente ${reference}]`).join(' ')
    return `${claim.text}${refs ? ` ${refs}` : ''}`
  }).join('\n').trim()
}
