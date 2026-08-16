import type { NormalizedParcelContext, NormativeHierarchyLevel } from '@/domain/parcel-context/types'
import { requiresDeterminedParcelRegime } from './applicabilityEngine'

export interface SupplementaryNormativeLayer {
  hierarchy: Extract<NormativeHierarchyLevel, 'autonomico' | 'estatal' | 'sectorial'>
  source: 'v1_global_catalog' | 'v2'
  documentNames?: readonly string[]
  scopes?: readonly string[]
  categories?: readonly string[]
}

export interface SupplementaryNormativeScope {
  layers: SupplementaryNormativeLayer[]
  retrieveMunicipal: boolean
}

// Identificadores canónicos de documentos oficiales ya presentes en el corpus V1.
// La lista no descubre ni infiere documentos: limita la consulta a normativa gallega
// cuya jurisdicción y naturaleza se han verificado en el catálogo cargado.
const GALICIAN_AUTONOMIC_URBANISTIC_DOCUMENTS = [
  'LSG CONSOLIDADA ENERO 2026- V2.pdf',
  '1-VERSION-CONSOLIDADA-COMENTADA-NHV_es.pdf',
  'Decreto_28_1999_Reglamento_Disciplina_Urbanistica_Galicia.pdf',
  'Lei_1_2021_Ordenacion_Territorio_Galicia.pdf',
] as const

const SECTORIAL_DOCUMENTS = {
  carreteras: [
    'Lei_8_2013_Estradas_Galicia.pdf',
    'Ley_37_2015_Carreteras_Estado.pdf',
    'Reglamento_General_Carreteras_RD_1812_1994.pdf',
  ],
  aguas: [
    'Lei_9_2010_Augas_Galicia.pdf',
    'TR_Ley_Aguas_RDL_1-2001_consolidado.pdf',
    'Reglamento_DPH_RD_849-1986_consolidado.pdf',
  ],
  costas: ['Ley_Costas_22-1988_consolidado.pdf', 'Reglamento_General_Costas_RD_876-2014.pdf'],
  patrimonio: ['Lei_Patrimonio_Cultural_Galicia_5-2016.pdf', 'Lei_3_1996_Proteccion_Caminos_Santiago.pdf'],
  red_natura: ['Red_Natura_Galicia_Plan_Director_Decreto_37_2014.pdf'],
} as const

type SectorialTopic = keyof typeof SECTORIAL_DOCUMENTS

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function hasQuestionTopic(question: string, topic: SectorialTopic) {
  const value = normalized(question)
  switch (topic) {
    case 'carreteras':
      return /\bcarreter/.test(value)
    case 'aguas':
      return /\b(?:agua|hidraulic|inundab)/.test(value)
    case 'costas':
      return /\bcost/.test(value)
    case 'patrimonio':
      return /\b(?:patrimonio|caminos? de santiago)/.test(value)
    case 'red_natura':
      return /\b(?:red natura|natura 2000)/.test(value)
  }
}

function hasDetectedAffect(context: NormalizedParcelContext, topic: SectorialTopic) {
  const pattern = {
    carreteras: /carreter/i,
    aguas: /agua|hidraulic|inundab/i,
    costas: /costa/i,
    patrimonio: /patrimonio|camino de santiago/i,
    red_natura: /red natura|natura 2000/i,
  }[topic]

  return context.knownConstraints.some(
    (constraint) => constraint.verification === 'confirmed' && pattern.test(constraint.value)
  )
}

function isAutonomicQuestion(question: string) {
  return /\b(?:normativa\s+auton[oó]mica|normativa\s+gallega|galicia|xunta|nhg|nhv|lei\s+do\s+solo)\b/i.test(
    question
  )
}

const DECLARED_AUTONOMIC_DEPENDENCIES = [
  {
    legalBasis: /\b(?:L\s*2\/2016|LSG|Lei\s+2\/2016)\b/i,
    documentNames: GALICIAN_AUTONOMIC_URBANISTIC_DOCUMENTS,
  },
] as const

function autonomicDocumentsRequiredByContext(context: NormalizedParcelContext) {
  const evidence = context.urbanisticFacts?.classification.evidence ?? []
  const declared = DECLARED_AUTONOMIC_DEPENDENCIES.find((dependency) =>
    evidence.some((item) => dependency.legalBasis.test(item.method))
  )
  return declared?.documentNames
}

function isCteQuestion(question: string) {
  return /\b(?:cte|c[oó]digo\s+t[eé]cnico(?:\s+de\s+la\s+edificaci[oó]n)?)\b/i.test(question)
}

export function resolveSupplementaryNormativeScope(
  question: string,
  context: NormalizedParcelContext
): SupplementaryNormativeScope {
  const layers: SupplementaryNormativeLayer[] = []
  const contextualAutonomicDocuments = autonomicDocumentsRequiredByContext(context)
  const autonomous = isAutonomicQuestion(question) || Boolean(contextualAutonomicDocuments)
  const cte = isCteQuestion(question)
  let sectorial = false

  if (autonomous) {
    layers.push({
      hierarchy: 'autonomico',
      source: 'v1_global_catalog',
      documentNames: contextualAutonomicDocuments ?? GALICIAN_AUTONOMIC_URBANISTIC_DOCUMENTS,
    })
  }

  if (cte) {
    layers.push({
      hierarchy: 'estatal',
      source: 'v2',
      scopes: ['estatal'],
      categories: ['CTE'],
    })
  }

  for (const topic of Object.keys(SECTORIAL_DOCUMENTS) as SectorialTopic[]) {
    if (!hasQuestionTopic(question, topic) || !hasDetectedAffect(context, topic)) continue
    sectorial = true
    layers.push({
      hierarchy: 'sectorial',
      source: 'v1_global_catalog',
      documentNames: SECTORIAL_DOCUMENTS[topic],
    })
  }

  return {
    layers,
    // Una cuestión explícitamente autonómica, CTE o sectorial no debe abrir la
    // recuperación municipal genérica. Las cuestiones paramétricas mantienen
    // además el bloque municipal, incluso cuando citan una norma superior.
    retrieveMunicipal: !(autonomous || cte || sectorial) || requiresDeterminedParcelRegime(question),
  }
}
