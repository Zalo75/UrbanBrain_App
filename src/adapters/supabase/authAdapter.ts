import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { AuthPort } from '@/domain/ports/AuthPort'
import { cookies, headers } from 'next/headers'

export class SupabaseAuthAdapter implements AuthPort {
  async updateSession(request: NextRequest): Promise<NextResponse> {
    const requestHeaders = new Headers(request.headers)

    let supabaseResponse = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({
              request: {
                headers: requestHeaders,
              },
            })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    // refreshes the auth token
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      requestHeaders.set('x-user-id', user.id)
    } else {
      requestHeaders.delete('x-user-id')
    }

    // Ensure downstream server components and route handlers receive the authentic x-user-id
    const finalResponse = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })
    supabaseResponse.cookies.getAll().forEach((c) => {
      finalResponse.cookies.set(c.name, c.value)
    })
    supabaseResponse = finalResponse

    const isProtectedPath =
      request.nextUrl.pathname.startsWith('/dashboard') ||
      request.nextUrl.pathname.startsWith('/control-center')

    if (
      !user &&
      !request.nextUrl.pathname.startsWith('/login') &&
      !request.nextUrl.pathname.startsWith('/auth') &&
      isProtectedPath
    ) {
      // no user, redirect to login page
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }

    // user is logged in, but tries to access login page
    if (user && request.nextUrl.pathname.startsWith('/login')) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }

    return supabaseResponse
  }

  async getUserId(): Promise<string | null> {
    try {
      if (typeof headers === 'function') {
        const headerStore = await headers()
        const headerUserId = headerStore?.get('x-user-id')
        if (headerUserId) return headerUserId
      }
    } catch {
      // headers() might not be available in non-request contexts (tests/scripts)
    }

    const supabase = await this._getServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user ? user.id : null
  }

  async login(credentials: Record<string, string>): Promise<{ error: string | null }> {
    const supabase = await this._getServerClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password
    })
    return { error: error ? error.message : null }
  }

  async logout(): Promise<{ error: string | null }> {
    const supabase = await this._getServerClient()
    const { error } = await supabase.auth.signOut()
    return { error: error ? error.message : null }
  }

  async signup(credentials: Record<string, string>): Promise<{ error: string | null }> {
    const supabase = await this._getServerClient()
    const { error } = await supabase.auth.signUp({
      email: credentials.email,
      password: credentials.password
    })
    return { error: error ? error.message : null }
  }

  async signInWithOAuth(provider: "google" | "apple", redirectTo: string): Promise<{ url: string | null; error: string | null }> {
    const supabase = await this._getServerClient()
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
      },
    })
    return { url: data?.url ?? null, error: error ? error.message : null }
  }

  // Helper interno
  private async _getServerClient() {
    const cookieStore = await cookies()
    return createServerClient(
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
              // Ignore in server components
            }
          },
        },
      }
    )
  }
}
