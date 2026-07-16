import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const DEFAULT_DESTINATION = '/dashboard'

function getCanonicalOrigin(request: Request): string {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configuredSiteUrl) {
    const siteUrl = new URL(configuredSiteUrl.replace(/\/+$/, ''))
    if (!['http:', 'https:'].includes(siteUrl.protocol)) {
      throw new Error('NEXT_PUBLIC_SITE_URL must use http or https')
    }
    return siteUrl.origin
  }

  if (process.env.NODE_ENV === 'development') {
    return new URL(request.url).origin
  }

  throw new Error('NEXT_PUBLIC_SITE_URL is required outside development')
}

function getInternalDestination(value: string | null, origin: string): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return DEFAULT_DESTINATION

  try {
    const destination = new URL(value, `${origin}/`)
    if (destination.origin !== origin) return DEFAULT_DESTINATION
    return `${destination.pathname}${destination.search}${destination.hash}`
  } catch {
    return DEFAULT_DESTINATION
  }
}

function loginRedirect(origin: string, message: string) {
  const url = new URL('/login', `${origin}/`)
  url.searchParams.set('message', message)
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const origin = getCanonicalOrigin(request)
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = getInternalDestination(searchParams.get('next'), origin)

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          },
        },
      }
    )
    
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (error) {
      return loginRedirect(origin, 'auth_callback_failed')
    }
    
    return NextResponse.redirect(new URL(next, `${origin}/`))
  }

  return loginRedirect(origin, 'no_code_provided')
}
