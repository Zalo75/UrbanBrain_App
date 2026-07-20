export interface CreateExpedienteState {
  status: 'idle' | 'error'
  message?: string
  field?: 'name' | 'province' | 'municipio' | 'refCatastral' | 'address' | 'coordinates' | 'planeamiento' | 'landClass' | 'contextNotice' | 'territorialContext'
}

export const initialCreateExpedienteState: CreateExpedienteState = { status: 'idle' }
