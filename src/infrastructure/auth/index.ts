import { AuthPort } from "@/domain/ports/AuthPort";
import { SupabaseAuthAdapter } from "@/adapters/supabase/authAdapter";

// Punto único de inyección de dependencias para el servicio de Auth.
// Si en el futuro migramos a Auth0, instanciaremos Auth0Adapter aquí
// y el resto de la aplicación (middleware, acciones) no notará el cambio.
export const authProvider: AuthPort = new SupabaseAuthAdapter();
