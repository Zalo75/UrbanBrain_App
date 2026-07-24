import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  archiveExpediente: vi.fn(),
  deleteExpediente: vi.fn(),
  updateExpediente: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/app/(dashboard)/expedientes/actions', () => ({
  archiveExpediente: mocks.archiveExpediente,
  deleteExpediente: mocks.deleteExpediente,
  updateExpediente: mocks.updateExpediente,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess } }))

import { ExpedienteActions } from './ExpedienteActions'

const expediente = {
  id: 'exp-a',
  name: 'Expediente de prueba',
  municipio: 'Culleredo',
  refCatastral: '7709702NH4970N0001SZ',
}

async function openDeleteDialog() {
  fireEvent.click(screen.getByRole('button', { name: /abrir menú/i }))
  const deleteItem = await screen.findByText('Eliminar expediente')
  fireEvent.click(deleteItem)
}

describe('ExpedienteActions permanent deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteExpediente.mockResolvedValue({ success: true })
  })

  it('keeps archive separate and cancellation performs no deletion', async () => {
    render(<ExpedienteActions expediente={expediente} membershipRole="owner" />)
    fireEvent.click(screen.getByRole('button', { name: /abrir menú/i }))

    expect(await screen.findByText('Archivar')).toBeTruthy()
    const deleteItem = await screen.findByText('Eliminar expediente')
    expect(deleteItem.closest('[data-variant="destructive"]')).toBeTruthy()
    fireEvent.click(deleteItem)
    expect(screen.getByText('Esta acción eliminará permanentemente el expediente, sus documentos y su historial. No se puede deshacer.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mocks.deleteExpediente).not.toHaveBeenCalled()
  })

  it('redirects and confirms success only after the server deletes the expediente', async () => {
    render(<ExpedienteActions expediente={expediente} membershipRole="admin" />)
    await openDeleteDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar definitivamente' }))

    await waitFor(() => expect(mocks.deleteExpediente).toHaveBeenCalledWith('exp-a'))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Expediente eliminado permanentemente.')
    expect(mocks.push).toHaveBeenCalledWith('/expedientes')
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('shows a clear error and does not redirect when deletion fails', async () => {
    mocks.deleteExpediente.mockResolvedValue({
      success: false,
      error: 'No se ha podido completar la eliminación. El expediente no se ha eliminado.',
    })
    render(<ExpedienteActions expediente={expediente} membershipRole="owner" />)
    await openDeleteDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar definitivamente' }))

    expect((await screen.findByRole('alert')).textContent).toContain('El expediente no se ha eliminado.')
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('keeps deletion available to the expediente owner regardless of organization role', async () => {
    const { rerender } = render(<ExpedienteActions expediente={expediente} membershipRole="member" />)
    fireEvent.click(screen.getByRole('button', { name: /abrir menú/i }))
    expect(await screen.findByText('Eliminar expediente')).toBeTruthy()

    rerender(<ExpedienteActions expediente={expediente} membershipRole="viewer" />)
    expect(screen.getByRole('button', { name: /abrir menú/i })).toBeTruthy()
  })
})
