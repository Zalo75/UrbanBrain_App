import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { generatePlanningKnowledge } from '@/application/planning-knowledge/generatePlanningKnowledge'
import { activateP1PlanningKnowledge } from '@/application/planning-knowledge/activateP1PlanningKnowledge'
import { diffPlanningKnowledgeReleases } from '@/application/planning-knowledge/versionPlanningKnowledge'
import type { PlanningKnowledgeRelease } from '@/domain/planning-knowledge/types'
import { collectCorunaPlanningKnowledgeInput } from '@/infrastructure/planning-knowledge/SiotugaPlanningKnowledgeSource'
import { CORUNA_P1_PLANNING_KNOWLEDGE } from '@/infrastructure/planning-knowledge/corunaP1PlanningKnowledge'

interface Options {
  write: boolean
  activateP1: boolean
  outputDirectory?: string
  previousRelease?: string
  concurrency: number
}

function parseOptions(arguments_: string[]): Options {
  const options: Options = { write: false, activateP1: false, concurrency: 4 }
  for (const argument of arguments_) {
    if (argument === '--write') options.write = true
    else if (argument === '--activate-p1') options.activateP1 = true
    else if (argument.startsWith('--output-dir=')) options.outputDirectory = argument.slice(13)
    else if (argument.startsWith('--previous=')) options.previousRelease = argument.slice(11)
    else if (argument.startsWith('--concurrency=')) {
      options.concurrency = Number.parseInt(argument.slice(14), 10)
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8) {
    throw new Error('--concurrency must be an integer between 1 and 8')
  }
  if (!options.write && options.outputDirectory) {
    throw new Error('--output-dir requires --write')
  }
  return options
}

async function readPreviousRelease(path?: string) {
  if (!path) return undefined
  return JSON.parse(await readFile(resolve(path), 'utf8')) as PlanningKnowledgeRelease
}

function safeFileName(id: string, mediaType: string) {
  const extension = mediaType.includes('json') ? 'json' : mediaType.includes('html') ? 'html' : 'xml'
  return `${id.replace(/[^a-z0-9._-]+/gi, '_')}.${extension}`
}

function runtimeP1Mismatches(release: PlanningKnowledgeRelease) {
  const runtimeByCode = new Map(
    CORUNA_P1_PLANNING_KNOWLEDGE.map((municipality) => [
      municipality.municipalityCode,
      municipality,
    ])
  )
  return release.municipalities
    .filter((municipality) => municipality.activation.status === 'active')
    .flatMap((municipality) => {
      const runtime = runtimeByCode.get(municipality.municipalityCode)
      const current = municipality.currentPlanning[0]
      const layer = municipality.layers.find(
        (item) =>
          item.kind === 'classification' &&
          item.officialDocumentId === municipality.currentInstrumentCandidates[0]
      )
      return runtime &&
        runtime.instrument.name === current?.name &&
        runtime.instrument.approvalDate === current.approvalDate &&
        runtime.classificationLayer.name === layer?.name
        ? []
        : [municipality.municipalityCode]
    })
    .concat(
      CORUNA_P1_PLANNING_KNOWLEDGE.flatMap((runtime) =>
        release.municipalities.some(
          (municipality) =>
            municipality.municipalityCode === runtime.municipalityCode &&
            municipality.activation.status === 'active'
        )
          ? []
          : [runtime.municipalityCode]
      )
    )
    .filter((code, index, codes) => codes.indexOf(code) === index)
    .sort()
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const input = await collectCorunaPlanningKnowledgeInput({ concurrency: options.concurrency })
  const draft = generatePlanningKnowledge(input)
  const release = options.activateP1 ? activateP1PlanningKnowledge(draft) : draft
  const previous = await readPreviousRelease(options.previousRelease)
  const difference = diffPlanningKnowledgeReleases(previous, release)
  const runtimeMismatches = options.activateP1 ? runtimeP1Mismatches(release) : []
  const patterns = Object.fromEntries(
    [...new Set(release.municipalities.map((municipality) => municipality.technicalPattern))]
      .sort()
      .map((pattern) => [
        pattern,
        release.municipalities.filter((municipality) => municipality.technicalPattern === pattern)
          .length,
      ])
  )

  console.log(
    JSON.stringify(
      {
        mode: options.write ? 'write' : 'dry-run',
        activation: options.activateP1 ? 'p1' : 'none',
        releaseId: release.releaseId,
        sha256: release.sha256,
        validation: release.validation,
        municipalities: release.municipalities.length,
        activeMunicipalities: release.municipalities.filter(
          (municipality) => municipality.activation.status === 'active'
        ).length,
        runtimeP1Mismatches: runtimeMismatches,
        patterns,
        changes: {
          added: difference.addedMunicipalities.length,
          removed: difference.removedMunicipalities.length,
          changed: difference.changedMunicipalities.length,
        },
      },
      null,
      2
    )
  )

  if (release.validation.status === 'blocked') {
    throw new Error(`Planning knowledge generation blocked: ${release.validation.errors.join(', ')}`)
  }
  if (runtimeMismatches.length > 0) {
    throw new Error(`P1 runtime knowledge mismatch: ${runtimeMismatches.join(', ')}`)
  }
  if (!options.write) return

  const outputDirectory = resolve(
    options.outputDirectory ?? `.artifacts/planning-knowledge/${release.releaseId}`
  )
  const rawDirectory = resolve(outputDirectory, 'raw')
  await mkdir(rawDirectory, { recursive: true })
  await writeFile(resolve(outputDirectory, 'release.json'), `${JSON.stringify(release, null, 2)}\n`)
  await writeFile(resolve(outputDirectory, 'diff.json'), `${JSON.stringify(difference, null, 2)}\n`)
  for (const rawSource of input.rawSources) {
    await writeFile(
      resolve(rawDirectory, safeFileName(rawSource.id, rawSource.mediaType)),
      rawSource.content
    )
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Planning knowledge generation failed')
  process.exitCode = 1
})
