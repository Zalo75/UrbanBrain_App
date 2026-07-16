import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getExpedienteAccess: vi.fn(), insert: vi.fn(), values: vi.fn(), createSignedUploadUrl: vi.fn() }))
vi.mock('@/application/authorization/expedienteAccess', () => ({ getExpedienteAccess: mocks.getExpedienteAccess }))
vi.mock('@/infrastructure/db/client', () => ({ db: { insert: mocks.insert } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ storage: { from: () => ({ createSignedUploadUrl: mocks.createSignedUploadUrl }) } })) }))

import { prepareDocumentUpload, processDocumentAction, registerDocument } from './actions'

const documentInput = { expedienteId: 'exp-a', filename: 'norma.pdf', storagePath: 'org-a/exp-a/norma.pdf', documentType: 'normativa' as const }

describe('document mutation roles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.insert.mockReturnValue({ values: mocks.values })
    mocks.values.mockResolvedValue(undefined)
    mocks.createSignedUploadUrl.mockResolvedValue({ data: { token: 'signed-token' }, error: null })
  })

  it('denies viewer document registration before writing', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({ ok: true, userId: 'viewer-a', orgId: 'org-a', membershipRole: 'viewer', expediente: { id: 'exp-a', orgId: 'org-a' } })
    await expect(registerDocument(documentInput)).rejects.toThrow('access denied')
    expect(mocks.insert).not.toHaveBeenCalled()
    await expect(prepareDocumentUpload({ expedienteId: 'exp-a', filename: 'norma.pdf', contentType: 'application/pdf', size: 100 })).rejects.toThrow('access denied')
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it.each(['owner', 'admin', 'member'] as const)('issues a signed upload to an authorized %s for a bounded PDF', async (role) => {
    mocks.getExpedienteAccess.mockResolvedValue({ ok: true, userId: `${role}-a`, orgId: 'org-a', membershipRole: role, expediente: { id: 'exp-a', orgId: 'org-a' } })
    await expect(prepareDocumentUpload({ expedienteId: 'exp-a', filename: '../norma.pdf', contentType: 'application/pdf', size: 100 })).resolves.toMatchObject({ token: 'signed-token' })
    const path = mocks.createSignedUploadUrl.mock.calls[0][0] as string
    expect(path).toMatch(/^organizations\/org-a\/expedientes\/exp-a\//)
    expect(path).not.toContain('../')
  })

  it.each(['owner', 'admin', 'member'] as const)('allows an operational %s to register a document', async (role) => {
    mocks.getExpedienteAccess.mockResolvedValue({ ok: true, userId: `${role}-a`, orgId: 'org-a', membershipRole: role, expediente: { id: 'exp-a', orgId: 'org-a' } })
    await expect(registerDocument(documentInput)).resolves.toEqual({ success: true })
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ expedienteId: 'exp-a', uploadedBy: `${role}-a` }))
  })

  it('keeps processing disabled without writing for every role', async () => {
    await expect(processDocumentAction('doc-a')).resolves.toMatchObject({ success: false, error: 'PROCESSING_DISABLED' })
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
