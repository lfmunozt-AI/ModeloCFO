import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Cliente Supabase ligado a la sesión del usuario (cookies). Respeta RLS:
 * todas las queries se ejecutan como el usuario autenticado. Úsalo en Route
 * Handlers y Server Components para leer/escribir datos del usuario.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Llamado desde un Server Component sin acceso de escritura a cookies.
            // El refresco de sesión lo realiza el middleware; aquí es seguro ignorar.
          }
        },
      },
    },
  );
}

/**
 * Cliente Supabase con service role — BYPASSA RLS. SOLO servidor.
 * Reservado para operaciones privilegiadas (p. ej. ingesta de documentos de AG02).
 * Nunca usar para servir datos directamente a un usuario sin filtrar por user_id.
 */
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
