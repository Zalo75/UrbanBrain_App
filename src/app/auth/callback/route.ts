import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // if "next" is in param, use it as the redirect URL
  const next = searchParams.get('next') ?? '/dashboard'

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
    
    console.log('[Auth Callback] Code received:', code.substring(0, 10) + '...');
    
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (error) {
      console.error('[Auth Callback] exchangeCodeForSession error:', error.message);
      console.error('[Auth Callback] full error:', JSON.stringify(error, null, 2));
      return NextResponse.redirect(`${origin}/login?message=exchange_error:${encodeURIComponent(error.message)}`)
    }
    
    console.log('[Auth Callback] Session exchanged successfully for user:', data.user?.email);
    console.log('[Auth Callback] Redirecting to:', `${origin}${next}`);
    return NextResponse.redirect(`${origin}${next}`)
  } else {
    console.warn('[Auth Callback] No code provided in URL searchParams');
  }

  // return the user to an error page with some instructions
  return NextResponse.redirect(`${origin}/login?message=no_code_provided`)
}
