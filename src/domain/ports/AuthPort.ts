import { NextRequest, NextResponse } from "next/server";

export interface AuthPort {
  /**
   * Verifica la sesión del usuario y refresca el token si es necesario.
   * Maneja las redirecciones a /login o /dashboard según el estado de autenticación.
   * Usado principalmente en el Middleware de Next.js.
   */
  updateSession(request: NextRequest): Promise<NextResponse>;

  /**
   * Obtiene el ID del usuario autenticado actual desde el servidor.
   * Devuelve null si no hay sesión válida.
   */
  getUserId(): Promise<string | null>;

  /**
   * Autentica al usuario con email y contraseña.
   * Devuelve un error como string si falla, o null si tiene éxito.
   */
  login(credentials: Record<string, string>): Promise<{ error: string | null }>;

  /**
   * Registra un nuevo usuario con email y contraseña.
   * Devuelve un error como string si falla, o null si tiene éxito.
   */
  signup(credentials: Record<string, string>): Promise<{ error: string | null }>;
  /**
   * Inicia el flujo de autenticación OAuth con un proveedor externo.
   * Devuelve la URL a la que se debe redirigir al usuario, o un error.
   */
  signInWithOAuth(provider: "google" | "apple", redirectTo: string): Promise<{ url: string | null; error: string | null }>;
}
