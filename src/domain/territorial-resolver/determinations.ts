import type {
  ContextDetermination,
  ContextDeterminationState,
  DeterminationVerification,
} from './types'
import type { ParcelContextSource } from '@/domain/parcel-context/types'

export function getEffectiveValue<T>(
  state: ContextDeterminationState<T> | undefined,
  legacyValue: T | undefined
): T | undefined {
  return getEffectiveDetermination(state)?.value ?? legacyValue
}

export function getEffectiveDetermination<T>(
  state: ContextDeterminationState<T> | undefined
): ContextDetermination<T> | undefined {
  if (state?.technician?.verification === 'technician_validated') {
    return state.technician
  }
  if (state?.technician) {
    return state.technician
  }
  if (state?.automatic) {
    return state.automatic
  }
  return undefined
}

export function createAutomaticDetermination<T>(
  value: T,
  source: ParcelContextSource,
  now = () => new Date()
): ContextDetermination<T> {
  return {
    value,
    origin: 'automatic',
    verification: 'unverified',
    determinedAt: now().toISOString(),
    source,
  }
}

export interface CreateTechnicianDeterminationOptions {
  verification?: DeterminationVerification
  now?: () => Date
}

export function createTechnicianDetermination<T>(
  value: T,
  recordedBy: string,
  currentAutomaticValue?: T,
  options?: CreateTechnicianDeterminationOptions
): ContextDetermination<T> {
  const verification = options?.verification ?? 'technician_validated'
  const now = options?.now ?? (() => new Date())
  const isoNow = now().toISOString()
  const isValidated = verification === 'technician_validated'
  
  return {
    value,
    origin: 'technician_selection',
    source: 'manual',
    verification,
    recordedAt: isoNow,
    recordedBy,
    validatedAt: isValidated ? isoNow : undefined,
    validatedBy: isValidated ? recordedBy : undefined,
    previousAutomaticValue: currentAutomaticValue,
  }
}

export function mergeAutomaticDetermination<T>(
  existingState: ContextDeterminationState<T> | undefined,
  newValue: T,
  source: ParcelContextSource,
  now = () => new Date()
): ContextDeterminationState<T> {
  const newAutomatic = createAutomaticDetermination(newValue, source, now)

  if (!existingState) {
    return {
      automatic: newAutomatic,
    }
  }

  return {
    ...existingState,
    automatic: newAutomatic,
  }
}
