import type { TerritorialDetectionSummary } from './normalizeParcelContext'
import type { TerritorialResolution, OrdinanceResolutionMetadata, ContextDeterminationState } from '@/domain/territorial-resolver/types'
import { allSourceChecks, officialContextForUse } from '@/application/territorial-resolver/territorialContinuity'
import { getEffectiveValue, createAutomaticDetermination } from '@/domain/territorial-resolver/determinations'
import { getMunicipalityByName, getProvinceById, getProvinceByMunicipalityIneCode, getProvinceByName } from '@/shared/territory'
import { territorialFieldConfirmations } from '@/application/territorial-resolver/fieldConfirmations'
import { applyManualAffectDecisions, applyManualFactDecisions } from '@/application/territorial-resolver/manualTerritorialContext'
import { assessClassificationResolution } from '@/domain/territorial-resolver/classificationDecision'
import { urbanisticFactsFromClassificationResolution } from '@/domain/territorial-resolver/urbanisticFacts'
import { applyActionAreaToUrbanisticFacts, clearAutomaticClassificationCandidate, isPureAutomaticDetectedZoneContext, planningZoneNamesFromCandidate } from '@/application/territorial-resolver/actionAreaSelection'
import { accountParcelGeometry, geometrySurface } from '@/domain/territorial-resolver/parcelAccounting'

export function detectionSummary(result: TerritorialResolution): TerritorialDetectionSummary {
  const effective = officialContextForUse(result) ?? result
  const classificationAssessment = assessClassificationResolution(
    effective?.planning.classificationResolution
  )
  const manual = result.continuity?.manualContext
  const storedActionArea = manual?.actionAreaSelection?.current
  const measuredArea = geometrySurface(storedActionArea?.geometry)
  const actionArea = storedActionArea ? { ...storedActionArea,
    surfaceSquareMetres: storedActionArea.surfaceSquareMetres > 0 ? storedActionArea.surfaceSquareMetres : measuredArea ?? storedActionArea.surfaceSquareMetres,
    parcelSurfaceSquareMetres: storedActionArea.parcelSurfaceSquareMetres > 0 ? storedActionArea.parcelSurfaceSquareMetres : geometrySurface(effective.parcelGeometry) ?? storedActionArea.parcelSurfaceSquareMetres,
  } : undefined
  const automaticClassificationCandidate = clearAutomaticClassificationCandidate(
    result.planning.classificationResolution,
    result.planning.classification,
    result.planning.urbanisticFacts
  )
  const pureAutomaticActionArea = isPureAutomaticDetectedZoneContext(result, manual)
  const actionAreaAutomaticallyConfirmed = Boolean(
    automaticClassificationCandidate &&
    result.planning.status === 'determined' &&
    (result.planning.conflicts?.length ?? 0) === 0 &&
    (!manual || pureAutomaticActionArea)
  )
  const automaticPlanningZones = planningZoneNamesFromCandidate(
    automaticClassificationCandidate
  )
  const automaticPlanningArea = automaticPlanningZones.length === 1
    ? automaticPlanningZones[0]
    : undefined
  const actionAreaCandidate = actionArea?.selectedCandidateId
    ? effective?.planning.classificationResolution?.candidates.find(
        (candidate) => candidate.id === actionArea.selectedCandidateId
      )
    : undefined
  const municipality = getMunicipalityByName(effective?.municipality ?? '')
  const province =
    getProvinceByMunicipalityIneCode(effective?.municipalityCode) ??
    (municipality ? getProvinceById(municipality.provinceId) : undefined) ??
    getProvinceByName(effective?.province ?? '')
  const automaticLandClass =
    effective?.planning.classification?.code === 'SU'
      ? 'urbano'
      : effective?.planning.classification?.code === 'SNR'
        ? 'nucleo_rural'
        : effective?.planning.classification?.code === 'SR'
          ? 'rustico'
          : effective?.planning.classification?.code

  const explicitOperationalValue = effective?.planning.classificationResolution?.finalSelection?.operationalValue?.trim() || undefined
  const manualClassification = manual?.classification?.trim() || undefined
  const classificationConflict = Boolean(
    explicitOperationalValue &&
    manualClassification &&
    explicitOperationalValue.toLocaleLowerCase() !== manualClassification.toLocaleLowerCase()
  )
  const reconciledAutomaticLandClass = automaticLandClass ?? explicitOperationalValue

  const automaticSource = effective?.planning.evidence.some(e => e.source === 'siotuga') ? 'siotuga' : 'urbanbrain'
  const automaticLandClassDet = reconciledAutomaticLandClass ? createAutomaticDetermination(reconciledAutomaticLandClass, automaticSource) : undefined
  const explicitSelectionDetermination = explicitOperationalValue && effective?.planning.classificationResolution?.finalSelection?.origin === 'manual'
    ? {
        value: explicitOperationalValue,
        origin: 'technician_selection' as const,
        source: 'manual' as const,
        verification: effective.planning.classificationResolution.finalSelection.technicianValidated ? 'technician_validated' as const : 'unverified' as const,
        recordedAt: effective.planning.classificationResolution.finalSelection.selectedAt ?? result.resolvedAt,
        recordedBy: effective.planning.classificationResolution.finalSelection.selectedBy ?? 'legacy-reconciliation',
      }
    : undefined
  const actionAreaLandClass = actionAreaCandidate?.kind === 'official_classification' ? (
    actionAreaCandidate.classification.code === 'SU'
      ? actionAreaCandidate.classification.categoryCode === 'SUSC' ||
        actionAreaCandidate.classification.categoryCode === 'SUNC'
        ? 'urbano_no_consolidado'
        : actionAreaCandidate.classification.categoryCode === 'SUC'
          ? 'urbano_consolidado'
          : 'urbano'
      : actionAreaCandidate.classification.code === 'SNR'
        ? 'nucleo_rural'
        : actionAreaCandidate.classification.code === 'SR'
          ? 'rustico'
          : actionAreaCandidate.classification.code
  ) : undefined
  // A work-area choice narrows the spatial context using an official candidate;
  // it must not manufacture a technician selection of the classification.
  const actionAreaLandClassDetermination = actionAreaLandClass
    ? createAutomaticDetermination(actionAreaLandClass, automaticSource)
    : undefined
  const classDet: ContextDeterminationState<string> = {
    automatic: actionAreaLandClassDetermination ?? (explicitSelectionDetermination ? undefined : automaticLandClassDet),
    technician: manual?.classificationDetermination?.technician ?? explicitSelectionDetermination
  }

  const landClass = classificationConflict
    ? undefined
    : getEffectiveValue(classDet, manualClassification ?? reconciledAutomaticLandClass)
  const parcelAffects = effective?.affects ?? result.affects
  const automaticAffects = actionArea?.selectionType === 'detected_zone' && actionArea.affects
    ? actionArea.affects
    : parcelAffects
  const affectResolution = applyManualAffectDecisions(
    automaticAffects.detected,
    manual?.affectDecisions
  )
  const checks = allSourceChecks(result)
  const hasIncompleteSource = checks.some((check) =>
    ['partial', 'timeout', 'unavailable', 'malformed'].includes(check.status)
  )
  const reliabilityMode = manual && !actionAreaAutomaticallyConfirmed
    ? manual.verification === 'technician_validated'
      ? 'technician_validated_manual'
      : 'manual_unverified'
    : result.continuity?.usingPreviousOfficialContext
      ? 'previous_official'
      : effective
        ? hasIncompleteSource
          ? 'partial_official'
          : 'current_official'
        : 'unresolved'
  const baseUrbanisticFacts =
    effective?.planning.urbanisticFacts ??
    urbanisticFactsFromClassificationResolution(effective.planning, result.resolvedAt)
  const urbanisticFacts = baseUrbanisticFacts
    ? applyActionAreaToUrbanisticFacts(
        applyManualFactDecisions(baseUrbanisticFacts, manual).effective,
        effective,
        actionArea
      )
    : undefined

  const ordinanceCandidates = result.planning.ordinanceCandidates?.length
    ? result.planning.ordinanceCandidates
    : effective?.planning.ordinanceCandidates ?? []
  const selectedManualOrdinance = manual?.ordinanceDetermination?.technician?.value ?? manual?.ordinance
  const selectedCandidate = selectedManualOrdinance
    ? ordinanceCandidates.find((candidate) =>
        candidate.identity.trim().toLocaleUpperCase() === selectedManualOrdinance.trim().toLocaleUpperCase()
      )
    : undefined
  const ordinanceResolution: OrdinanceResolutionMetadata | undefined =
    result.planning.ordinanceResolution ??
    (selectedCandidate && manual?.ordinanceDetermination?.technician
      ? {
          status: 'USER_CONFIRMED',
          identity: { code: selectedCandidate.identity, label: selectedCandidate.identity },
          confidence: selectedCandidate.confidence ?? 'unknown',
           provenance: selectedCandidate.provenance,
           identityId: selectedCandidate.identityId,
           normativeReferences: selectedCandidate.normativeReferences,
           confirmationSource: 'user',
          confirmedByUser: true,
        }
      : effective?.planning.ordinanceResolution)

  const summary: TerritorialDetectionSummary = {
    schemaVersion: 1,
    planningEvidence: effective.planning.evidence,
    planningDocuments: effective.planning.documents,
    planningResources: effective.planning.resources,
    planningSourceChecks: effective.planning.sourceChecks,
    classificationResolution: effective.planning.classificationResolution,
    cartographicSourceChecks: result.planning.cartographicSourceChecks ?? effective.planning.cartographicSourceChecks,
    applicableInstruments: effective.planning.applicableInstruments,
    contextualCandidates: effective.planning.contextualCandidates,
    unknownReasons: {
      ...(!landClass
        ? { classification: classificationConflict
          ? 'Conflicting explicit historical classification values; reconciliation is required.'
          : 'No supported classification determination.' }
        : {}),
      ...(!ordinanceResolution?.identity ? { ordinance: 'No reconciled parcel ordinance identity; cartographic proposals remain evidence.' } : {}),
      cadastralDeclaredSurface: 'Declared cadastral register surface is not supplied by the current adapter; measured geometry is stored separately.',
    },
    parcelSurfaceSquareMetres: geometrySurface(effective.parcelGeometry),
    coverage: accountParcelGeometry(actionArea?.geometry ?? effective.parcelGeometry, effective.planning.classificationResolution?.candidates),
    cadastralReference: effective?.cadastralReference,
    parcelReference: effective?.parcelReference,
    provinceId: province?.id,
    provinceName: effective?.province,
    provinceCode: effective?.provinceCode,
    municipalityId: municipality?.id,
    municipalityName: effective?.municipality,
    municipalityCode: effective?.municipalityCode,
    address: effective?.normalizedAddress,
    lat: effective?.coordinates?.lat,
    lng: effective?.coordinates?.lng,
    parcelGeometry: effective?.parcelGeometry,
    locationStatus: effective?.status ?? result.status,
    locationConfidence: effective?.confidence ?? result.confidence,
    locationSource: (effective?.evidence.some((item) => item.source === 'catastro')
      ? 'catastro'
      : effective?.evidence.some((item) => item.source === 'cartociudad')
        ? 'cartociudad'
        : undefined) as TerritorialDetectionSummary['locationSource'],
    planningInstrument: effective?.planning.instrument,
    planningStatus: effective?.planning.applicableInstruments?.some(
      (instrument) => instrument.status === 'current'
    )
      ? 'vigente'
      : effective?.planning.status === 'determined'
        ? 'vigente'
        : undefined,
    planningApplicabilityStatus:
      actionArea?.selectionType === 'detected_zone'
        ? actionArea.verification === 'technician_validated'
          ? 'determined'
          : actionAreaAutomaticallyConfirmed
            ? effective?.planning.status ?? 'not_determined'
          : 'partial'
        : effective?.planning.status ?? 'not_determined',
    planningCanAnswerConcreteParameters:
      effective?.planning.canAnswerConcreteParameters ?? false,
    classificationConfidenceLevel: classificationAssessment.level,
    classificationReason: classificationAssessment.reason,
    classificationSources: classificationAssessment.sources,
    classificationWarnings: classificationAssessment.warnings,
    urbanisticFacts,
    planningWarnings: effective?.planning.warnings ?? [],
    planningConflicts:
      actionArea?.selectionType === 'detected_zone'
        ? []
        : effective?.planning.conflicts ?? [],
    parcelPlanningConflicts: effective?.planning.conflicts ?? [],
    planningSource: (effective?.planning.evidence.some((item) => item.source === 'siotuga')
      ? 'siotuga'
      : effective?.planning.status === 'determined'
        ? 'urbanbrain'
        : undefined) as TerritorialDetectionSummary['planningSource'],
    landClass,
    automaticLandClass: reconciledAutomaticLandClass,
    planningArea:
      actionArea?.selectionType === 'detected_zone'
        ? actionArea.planningZone
        : manual?.area ??
      automaticPlanningArea ??
      (effective?.planning.status !== 'conflict' && effective?.planning.areas?.length === 1
        ? effective.planning.areas[0].name
        : undefined),
    qualification: manual?.ordinanceDetermination
      ? getEffectiveValue(manual.ordinanceDetermination, manual.ordinance)
      : manual?.ordinance,
    classificationDetermination: classDet,
    categoryDetermination: manual?.categoryDetermination,
    ordinanceCandidates,
    visualResolutionState: effective?.planning.visualResolutionState ?? result.planning.visualResolutionState,
    visualObservations: effective?.planning.visualObservations ?? result.planning.visualObservations,
    visualExplanation: effective?.planning.visualExplanation ?? result.planning.visualExplanation,
    visualCandidates: effective?.planning.visualCandidates ?? result.planning.visualCandidates,
    ordinanceResolution,
    ordinanceDetermination: manual?.ordinanceDetermination || (ordinanceCandidates.length ? { candidates: ordinanceCandidates, status: result.planning.ordinanceResolutionStatus } : undefined),
    manualContext: actionAreaAutomaticallyConfirmed ? undefined : manual,
    actionAreaSelection: manual?.actionAreaSelection ? { ...manual.actionAreaSelection, current: actionArea } : undefined,
    actionAreaAutomaticallyConfirmed,
    reliability: {
      mode: reliabilityMode as TerritorialDetectionSummary['reliability'] extends infer R ? R extends { mode: infer M } ? M : never : never,
      latestAttemptAt: result.attemptStartedAt ?? result.resolvedAt,
      officialContextResolvedAt: effective?.resolvedAt,
      usingPreviousOfficialContext: result.continuity?.usingPreviousOfficialContext ?? false,
      sourceChecks: checks,
    },
    warnings: [
      ...result.warnings,
      ...result.planning.warnings,
      ...result.affects.warnings,
      ...(effective && effective !== result ? effective.planning.warnings : []),
    ],
    conflicts: result.conflicts,
    affects: {
      ...automaticAffects,
      automatic: automaticAffects.detected,
      parcel: parcelAffects.detected,
      manualDecisions: manual?.affectDecisions ?? [],
      detected: affectResolution.effective,
    },
    resolvedAt: result.resolvedAt,
    inputMethod: result.inputMethod,
    fieldConfirmations: territorialFieldConfirmations(effective ?? result),
  }
  return summary
}
