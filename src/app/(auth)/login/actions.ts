'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { authProvider } from '@/infrastructure/auth'

export async function login(formData: FormData) {
  const credentials = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { error } = await authProvider.login(credentials)

  if (error) {
    redirect('/login?message=Could not authenticate user')
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signup(formData: FormData) {
  const credentials = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { error } = await authProvider.signup(credentials)

  if (error) {
    redirect('/login?message=Could not authenticate user')
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function loginWithGoogle() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const { url, error } = await authProvider.signInWithOAuth('google', `${siteUrl}/auth/callback`)
  
  if (error) {
    redirect('/login?message=Could not authenticate with Google')
  }

  if (url) {
    redirect(url)
  }
}
