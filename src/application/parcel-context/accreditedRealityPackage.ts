import { cartographicToolLimit } from './cartographicViewTool'
import type { TerritorialDetectionSummary } from './normalizeParcelContext'
import type { NormalizedParcelContext, NormativeCandidate } from '@/domain/parcel-context/types'
import type { OfficialClassificationAttributes, TerritorialEvidence } from '@/domain/territorial-resolver/types'

export interface AccreditedRealitySource {
  id: string
  /** Stable aliases already present in the official evidence (for transition from model-emitted official IDs). */
  aliases?: string[]
  content: string
  sourceUrl?: string
  source: string
}

export interface AccreditedRealityPackage {
  packageVersion: 'expedientes-accredited-reality-v1'
  identity: {
    cadastralReference?: string | null
    municipality?: string | null
    municipalityCode?: string | null
    province?: string | null
    address?: string | null
    coordinates?: { lat: number; lng: number } | null
  }
  parcel: {
    geometry?: unknown
    surfaceSquareMetres?: number
  }
  planning: {
    instrument?: string | null
    status?: string | null
    applicableInstruments?: unknown[]
    documents?: unknown[]
    resources?: unknown
    sourceChecks?: unknown[]
    evidence?: TerritorialEvidence[]
  }
  observedCandidates: Array<{
    candidateId: string
    classification?: unknown
    areas?: unknown[]
    coverage?: unknown
    officialAttributes: OfficialClassificationAttributes[]
    evidence: TerritorialEvidence[]
    confidence?: string
    normalizationStatus?: string
  }>
  derivedUrbanisticFacts?: unknown
  affects?: unknown
  conflicts: unknown[]
  warnings: unknown[]
  unknowns: string[]
  derivedContext: {
    landClass?: string
    qualification?: string
    planningArea?: string
    classificationStatus?: string
    reliability?: unknown
  }
  confirmedNormativeIdentity?: {
    code: string
    label?: string
    status: 'USER_CONFIRMED'
    confirmedByUser?: boolean
    confirmationSource?: 'automatic' | 'user'
    provenance: string[]
    instrumentId?: string
    identityId?: string
    normativeReferences?: unknown[]
  }
  sources: AccreditedRealitySource[]
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function candidateSource(candidate: AccreditedRealityPackage['observedCandidates'][number]): AccreditedRealitySource {
  return {
    id: `candidate:${candidate.candidateId}`,
    aliases: [candidate.candidateId, ...candidate.officialAttributes.flatMap((attribute) => [attribute.sourceFeatureId].filter(Boolean))],
    source: 'siotuga',
    content: [
      `Hecho observado en candidato territorial ${candidate.candidateId}.`,
      'EVIDENCIA OFICIAL LITERAL / OBSERVADA:',
      json(candidate.officialAttributes),
      `Cobertura/intersección calculada: ${json(candidate.coverage)}`,
      `INFORMACIÓN DERIVADA POR URBANBRAIN — clasificación/categoría: ${json(candidate.classification)}`,
      `INFORMACIÓN DERIVADA POR URBANBRAIN — ámbitos/denominaciones: ${json(candidate.areas)}`,
    ].join('\n'),
    sourceUrl: candidate.evidence[0]?.sourceUrl,
  }
}

export function buildAccreditedRealityPackage(
  detected: TerritorialDetectionSummary | null | undefined,
  context: NormalizedParcelContext,
): AccreditedRealityPackage {
  const candidates = (detected?.classificationResolution?.candidates ?? [])
    .filter((candidate): candidate is Extract<NonNullable<TerritorialDetectionSummary['classificationResolution']>['candidates'][number], { kind: 'official_classification' }> => candidate.kind === 'official_classification')
    .map((candidate) => ({
      candidateId: candidate.id,
      classification: candidate.classification,
      areas: candidate.areas,
      coverage: candidate.parcelCoverage,
      officialAttributes: candidate.officialAttributes ?? [],
      evidence: candidate.evidence,
      confidence: candidate.confidence,
      normalizationStatus: candidate.normalizationStatus,
    }))

  const sources: AccreditedRealitySource[] = []
  const resolution = detected?.ordinanceResolution
  const resolutionCode = resolution?.status === 'USER_CONFIRMED'
    ? resolution.identity?.code?.trim() || resolution.identity?.label?.trim()
    : undefined
  const confirmedCandidate = detected?.ordinanceCandidates?.find((candidate) =>
    candidate.status === 'user_confirmed' &&
    candidate.identity.trim().toLocaleUpperCase() === resolutionCode?.toLocaleUpperCase()
  ) ?? detected?.ordinanceCandidates?.find((candidate) => candidate.status === 'user_confirmed')
  const confirmedNormativeIdentity = resolutionCode || confirmedCandidate
    ? {
        code: resolutionCode ?? confirmedCandidate!.identity,
        ...(resolution?.identity?.label || confirmedCandidate?.identity
          ? { label: resolution?.identity?.label ?? confirmedCandidate?.identity }
          : {}),
        status: 'USER_CONFIRMED' as const,
        ...(resolution?.confirmedByUser !== undefined ? { confirmedByUser: resolution.confirmedByUser } : {}),
        ...(resolution?.confirmationSource ? { confirmationSource: resolution.confirmationSource } : confirmedCandidate?.confirmationSource ? { confirmationSource: confirmedCandidate.confirmationSource } : {}),
        provenance: [...new Set(resolution?.provenance ?? confirmedCandidate?.provenance ?? [])],
        ...(confirmedCandidate?.instrumentId ? { instrumentId: confirmedCandidate.instrumentId } : {}),
        ...(resolution?.identityId ?? confirmedCandidate?.identityId ? { identityId: resolution?.identityId ?? confirmedCandidate?.identityId } : {}),
        ...(resolution?.normativeReferences ?? confirmedCandidate?.normativeReferences ? { normativeReferences: resolution?.normativeReferences ?? confirmedCandidate?.normativeReferences } : {}),
      }
    : undefined
  for (const candidate of candidates) sources.push(candidateSource(candidate))
  if (detected?.planningEvidence?.length) {
    sources.push({
      id: 'planning:evidence',
      aliases: [
        detected.planningInstrument,
        ...(detected.applicableInstruments ?? []).map((instrument) => typeof instrument === 'object' && instrument && 'id' in instrument ? String((instrument as { id?: unknown }).id ?? '') : ''),
      ].filter((value): value is string => Boolean(value)),
      source: detected.planningEvidence[0]?.source ?? 'siotuga',
      sourceUrl: detected.planningEvidence[0]?.sourceUrl,
      content: `SOURCE_REF: planning:evidence\nEvidencia del instrumento y sus fuentes:\n${json(detected.planningEvidence)}`,
    })
  }
  if (!sources.length) {
    sources.push({
      id: 'context:status',
      source: 'urbanbrain',
      content: 'No se han localizado candidatos espaciales con atributos oficiales en la detección cargada.',
    })
  }

  const unknowns = [
    !(detected?.planningInstrument || detected?.applicableInstruments?.length) ? 'instrumento de planeamiento no determinado' : undefined,
    candidates.some((candidate) => candidate.normalizationStatus === 'unmapped') ? 'significado operacional de uno o más códigos no determinado' : undefined,
    detected?.classificationResolution?.status && detected.classificationResolution.status !== 'clear'
      ? `resolución de clasificación: ${detected.classificationResolution.status}`
      : undefined,
    ...(detected?.unknownReasons ? Object.values(detected.unknownReasons) : []),
  ].filter((value): value is string => Boolean(value))

  const packageValue: AccreditedRealityPackage = {
    packageVersion: 'expedientes-accredited-reality-v1',
    identity: {
      cadastralReference: detected?.cadastralReference ?? context.cadastralReference?.value,
      municipality: detected?.municipalityName ?? context.municipality?.value.name,
      municipalityCode: detected?.municipalityCode ?? context.municipality?.value.ineCode,
      province: detected?.provinceName ?? context.province?.value.name,
      address: detected?.address ?? context.address?.value,
      coordinates: context.coordinates?.value ?? null,
    },
    parcel: {
      geometry: detected?.parcelGeometry ?? context.parcelGeometry,
      surfaceSquareMetres: detected?.parcelSurfaceSquareMetres ?? context.parcelSurfaceSquareMetres,
    },
    planning: {
      instrument: detected?.planningInstrument,
      status: detected?.planningStatus,
      applicableInstruments: detected?.applicableInstruments,
      documents: detected?.planningDocuments,
      resources: detected?.planningResources,
      sourceChecks: detected?.planningSourceChecks,
      evidence: detected?.planningEvidence,
    },
    observedCandidates: candidates,
    derivedUrbanisticFacts: detected?.urbanisticFacts,
    affects: detected?.affects,
    conflicts: [...(detected?.conflicts ?? []), ...(detected?.planningConflicts ?? []), ...(detected?.parcelPlanningConflicts ?? [])],
    warnings: [...(detected?.warnings ?? []), ...(detected?.planningWarnings ?? []), ...(detected?.classificationWarnings ?? [])],
    unknowns,
    derivedContext: {
      landClass: context.landClass?.value,
      qualification: context.qualification?.value,
      planningArea: context.planningArea?.value,
      classificationStatus: detected?.urbanisticFacts?.classification.status,
      reliability: context.reliability,
    },
    ...(confirmedNormativeIdentity ? { confirmedNormativeIdentity } : {}),
    sources,
  }
  return packageValue
}

export function accreditedRealitySourcesAsCandidates(pkg: AccreditedRealityPackage): NormativeCandidate[] {
  return pkg.sources.map((source) => ({
    id: source.id,
    sourceAliases: source.aliases,
    content: source.content,
    sourceUrl: source.sourceUrl ?? null,
    documentName: 'Evidencia territorial acreditada',
    hierarchy: 'municipal',
    evidenceSpecificity: 'SPECIFIC',
  }))
}

export interface AccreditedContextForReasoning {
  parcel: {
    cadastralReference?: string | null
    municipality?: string | null
    surfaceSquareMetres?: number
  }
  urbanisticFacts: {
    instrument?: string | null
    candidates: Array<{
      id: string
      classification?: unknown
      areas?: unknown[]
      attributes: Record<string, string>
    }>
  }
  documentCatalog: Array<{ id: string; title: string; documentType?: string; preview?: string }> | 'USE_TOOL'
  derivedContext: AccreditedRealityPackage['derivedContext']
  confirmedNormativeIdentity?: AccreditedRealityPackage['confirmedNormativeIdentity']
  unknowns: string[]
  conflicts: unknown[]
  warnings: unknown[]
}

export function buildAccreditedContextForReasoning(pkg: AccreditedRealityPackage): AccreditedContextForReasoning {
  const documentCatalog = Array.isArray(pkg.planning.documents) && pkg.planning.documents.length > 0
    ? pkg.planning.documents.map((doc: any) => ({
        id: String(doc.id ?? ''),
        title: String(doc.title ?? ''),
        documentType: doc.documentType ? String(doc.documentType) : undefined,
        ...(doc.preview ? { preview: String(doc.preview) } : {}),
      })).filter((doc) => doc.id && doc.title)
    : 'USE_TOOL'

  return {
    parcel: {
      cadastralReference: pkg.identity.cadastralReference,
      municipality: pkg.identity.municipality,
      surfaceSquareMetres: pkg.parcel.surfaceSquareMetres,
    },
    urbanisticFacts: {
      instrument: pkg.planning.instrument,
      candidates: pkg.observedCandidates.map((candidate) => {
        const attributes: Record<string, string> = {}
        for (const attr of candidate.officialAttributes) {
          if (attr.classificationCode) attributes.classificationCode = attr.classificationCode
          if (attr.categoryCode) attributes.categoryCode = attr.categoryCode
          if (attr.legalClassificationCode) attributes.legalClassificationCode = attr.legalClassificationCode
          if (attr.legalCategoryCode) attributes.legalCategoryCode = attr.legalCategoryCode
          if (attr.planningCategoryCode) attributes.planningCategoryCode = attr.planningCategoryCode
          if (attr.denomination) attributes.denomination = attr.denomination
          if (attr.use) attributes.use = attr.use
          if (attr.status) attributes.status = attr.status
        }
        return {
          id: `candidate:${candidate.candidateId}`,
          classification: candidate.classification,
          areas: candidate.areas,
          attributes,
        }
      }),
    },
    documentCatalog,
    derivedContext: pkg.derivedContext,
    ...(pkg.confirmedNormativeIdentity ? { confirmedNormativeIdentity: pkg.confirmedNormativeIdentity } : {}),
    unknowns: pkg.unknowns,
    conflicts: pkg.conflicts,
    warnings: pkg.warnings,
  }
}

export interface MinimalContinuationContext {
  parcel: {
    cadastralReference?: string | null
    municipality?: string | null
    surfaceSquareMetres?: number
  }
  urbanisticFacts: {
    instrument?: string | null
    candidates: Array<{
      id: string
      classification?: unknown
      areas?: unknown[]
      attributes: Record<string, string>
    }>
  }
  confirmedNormativeIdentity?: AccreditedRealityPackage['confirmedNormativeIdentity']
  unknowns: string[]
  conflicts?: unknown[]
  warnings: unknown[]
}

export function buildMinimalContinuationContext(pkg: AccreditedRealityPackage): MinimalContinuationContext {
  return {
    parcel: {
      cadastralReference: pkg.identity.cadastralReference,
      municipality: pkg.identity.municipality,
      surfaceSquareMetres: pkg.parcel.surfaceSquareMetres,
    },
    urbanisticFacts: {
      instrument: pkg.planning.instrument,
      candidates: pkg.observedCandidates.map((candidate) => {
        const attributes: Record<string, string> = {}
        for (const attr of candidate.officialAttributes) {
          if (attr.classificationCode) attributes.classificationCode = attr.classificationCode
          if (attr.categoryCode) attributes.categoryCode = attr.categoryCode
          if (attr.legalClassificationCode) attributes.legalClassificationCode = attr.legalClassificationCode
          if (attr.legalCategoryCode) attributes.legalCategoryCode = attr.legalCategoryCode
          if (attr.planningCategoryCode) attributes.planningCategoryCode = attr.planningCategoryCode
          if (attr.denomination) attributes.denomination = attr.denomination
          if (attr.use) attributes.use = attr.use
          if (attr.status) attributes.status = attr.status
        }
        return {
          id: `candidate:${candidate.candidateId}`,
          classification: candidate.classification,
          areas: candidate.areas,
          attributes,
        }
      }),
    },
    ...(pkg.confirmedNormativeIdentity ? { confirmedNormativeIdentity: pkg.confirmedNormativeIdentity } : {}),
    unknowns: pkg.unknowns,
    ...(pkg.conflicts && pkg.conflicts.length > 0 ? { conflicts: pkg.conflicts } : {}),
    warnings: pkg.warnings,
  }
}

export interface AccreditedRealityPrompt {
  systemPrompt: string
  userPrompt: string
  package: AccreditedRealityPackage
  question: string
}

export function buildAccreditedRealityPrompt(pkg: AccreditedRealityPackage, question: string): AccreditedRealityPrompt {
  const contextForReasoning = buildAccreditedContextForReasoning(pkg)
  const confirmedIdentityInstruction = pkg.confirmedNormativeIdentity
    ? ` El expediente ya tiene confirmada explícitamente la identidad normativa ${pkg.confirmedNormativeIdentity.code}. Trátala como realidad canónica del expediente y no vuelvas a determinar qué ordenanza es aplicable. Puedes y debes consultar los documentos oficiales necesarios para obtener sus artículos, usos, parámetros y condiciones, conservando su procedencia y nivel de verificación real. La regla de no asignar ordenanza sigue aplicándose cuando no exista una identidad confirmada.`
    : ''
  return {
    systemPrompt: `Eres un técnico experto en arquitectura, urbanismo y planeamiento. La evidencia entregada determina qué hechos están acreditados, pero puedes usar tu conocimiento profesional general para interpretar y razonar sobre ella. Distingue claramente HECHO ACREDITADO de INTERPRETACIÓN/INFERENCIA: una interpretación conocida por ti no se convierte automáticamente en hecho acreditado. Si necesitas una fuente concreta para cerrar jurídicamente una cuestión, indícala. No inventes hechos, parámetros, geometrías, identidades ni fuentes. Si no puedes cerrar una cuestión, indica qué evidencia concreta adicional necesitarías. Puedes responder directamente o solicitar una o varias herramientas read-only: usa action=tool_call con toolName=get_instrument_documents y toolArguments={} para consultar el inventario oficial, o con toolName=get_instrument_document_content y toolArguments={documentId,query} para buscar únicamente dentro de un documento previamente inventariado. Devuelve un único objeto JSON por respuesta; puedes pedir nuevas herramientas en continuaciones. No envíes municipio, instrumento, URL, ruta ni filtros. Puedes solicitar get_cartographic_view: acquire requiere operation,representation=historical|modern|pair|legend,bbox={minLat,minLng,maxLat,maxLng},width,height (64..1600); extensión flexible hasta 2 grados por eje en EPSG:4326. El municipio e instrumento vienen del expediente. render_alignment requiere operation,sourceViewId,referenceViewId,bbox,width,height,transform={sourcePixelPivot:{x,y},targetPixelPivot:{x,y},rotationDegrees,scaleX,scaleY},opacity (0..1),phase=provisional|freeze. Los pivotes y parámetros usan píxeles de A original de la vista y B de referencia inmutables: escala local original, rotación, traslación. Cambiar el viewport no cambia parámetros. El recibo de freeze identifica una hipótesis inmutable, no la acepta. Para inspeccionarla repite sus referencias y parámetros; una corrección crea otra provisional. Luna elige libremente vistas amplias, intermedias o próximas y puede volver a alejarse. Simplifica mentalmente redes, cruces, costa y curvas; prueba una primera colocación plausible sin exigir correspondencias inequívocas. Observa el render, busca coincidencias nuevas, corrige o rechaza; no deformes localmente. Puedes probar varias hipótesis. Una superposición provisional con transformación identidad (rotación 0, escala X/Y 1 y pivotes coincidentes) sirve únicamente como observación inicial: si existe estructura territorial visible suficiente para explorar correspondencias, no cierres la investigación basándote solo en ella. Prueba al menos una hipótesis provisional no identidad informada por lo observado antes de abstenerte. Antes de concluir, congela una y comprueba estructuras distribuidas que no usaste para ajustar; documenta cuáles ajustaron y cuáles comprobaron y las vistas utilizadas. Cambios locales de época no bastan para rechazar; busca contradicciones persistentes/topológicas. La parcela no interviene en reconocimiento, ajuste ni validación. Las imágenes cartographic-view solo pueden citarse en claims de limitation para describir interpretación/hipótesis y límites, nunca como hechos normativos o conclusiones efectivas. No asignes ordenanza. No transfieras BBOX WMS a otro raster original ni reutilices parámetros de otro caso. Hay hasta ${cartographicToolLimit()} tools si usas cartografía (configurable 4..16), con plazo global de 120 s; cuota/timeout significan investigación incompleta, no refutación. Si respondes, usa action=final, answerMode, claims y missingFacts. Cada claim debe citar sourceRefs existentes.${confirmedIdentityInstruction}`,
    userPrompt: `PAQUETE FACTUAL ACREDITADO (los campos derivedContext son derivados y no sustituyen los literales):\n${json(contextForReasoning)}\n\nIDENTIFICADORES ESTABLES PARA CITAS (sourceRefs):\n${json(pkg.sources.map((source) => ({ sourceRef: source.id, aliases: source.aliases ?? [] })))}\nUsa exclusivamente estos sourceRef estables o sus aliases literales; no uses índices posicionales ni inventes identificadores.\n\nCONSULTA DEL TÉCNICO:\n${question}`,
    package: pkg,
    question,
  }
}

