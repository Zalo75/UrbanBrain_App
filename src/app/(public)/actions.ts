'use server'

export async function submitContactForm(_data: FormData) {
  void _data
  return {
    success: false,
    error: 'El formulario de contacto estará disponible próximamente.',
  }
}
