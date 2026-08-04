import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const DEFAULT_DESTINATION = '/dashboard'

function traceCallback(event: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_AUTH_CALLBACK === 'true') {
    console.info('[auth/callback]', JSON.stringify({ event, ...details }))
  }
}

function safeErrorDetails(error: unknown) {
  const details = error !== null && typeof error === 'object'
    ? error as Record<string, unknown>
    : {}

  return {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorMessage: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
    errorStatus: typeof details.status === 'number' ? details.status : undefined,
    errorCode: typeof details.code === 'string' ? details.code : undefined,
  }
}

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

  traceCallback('callback_received', {
    origin,
    hasAuthorizationCode: Boolean(code),
    hasInternalNextDestination: next !== DEFAULT_DESTINATION,
  })

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
    
    let error
    try {
      ({ error } = await supabase.auth.exchangeCodeForSession(code))
    } catch (exchangeError) {
      traceCallback('session_exchange_threw', safeErrorDetails(exchangeError))
      return loginRedirect(origin, 'auth_callback_failed')
    }
    
    if (error) {
      traceCallback('session_exchange_failed', safeErrorDetails(error))
      return loginRedirect(origin, 'auth_callback_failed')
    }

    traceCallback('session_exchange_succeeded', { origin })
    
    return NextResponse.redirect(new URL(next, `${origin}/`))
  }

  return loginRedirect(origin, 'no_code_provided')
}
