import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase para componentes de cliente (browser).
 * Usa la anon key pública; toda la seguridad la garantiza RLS.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
