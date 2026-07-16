import { describe, expect, it } from 'vitest'
import { submitContactForm } from './actions'

describe('contact form beta state', () => {
  it('never reports a fake success while no delivery channel exists', async () => {
    const form = new FormData()
    form.set('email', 'not-logged@example.invalid')
    await expect(submitContactForm(form)).resolves.toEqual({
      success: false,
      error: 'El formulario de contacto estará disponible próximamente.',
    })
  })
})
