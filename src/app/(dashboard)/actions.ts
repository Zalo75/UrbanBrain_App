'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { authProvider } from '@/infrastructure/auth'

export async function logout() {
  const { error } = await authProvider.logout()
  if (error) redirect('/login?message=logout_failed')

  revalidatePath('/', 'layout')
  redirect('/login?message=signed_out')
}
