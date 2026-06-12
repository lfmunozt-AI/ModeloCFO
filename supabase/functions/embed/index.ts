// Supabase Edge Function: embed
//
// Genera embeddings con el modelo `gte-small` (384 dimensiones) que corre dentro
// del runtime de Edge Functions de Supabase (Supabase.ai). NO depende de ningún
// proveedor externo de embeddings: el vector se calcula en el edge.
//
// Contrato:
//   POST  { "texts": string[] }  ->  200 { "embeddings": number[][] }
//
// Seguridad: exige un JWT válido de Supabase Auth en el header Authorization.
// El token se valida contra Auth antes de calcular nada. Esto evita que la
// función sea un oráculo de embeddings abierto a cualquiera.
//
// Despliegue:  supabase functions deploy embed
// (verify_jwt queda activo por defecto; además lo comprobamos en código.)

import { createClient } from "jsr:@supabase/supabase-js@2";

// Una única sesión del modelo, reutilizada entre invocaciones (warm start).
const session = new Supabase.ai.Session("gte-small");

const JSON_HEADERS = { "Content-Type": "application/json" };

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  // ── Verificación de JWT ─────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return new Response(
      JSON.stringify({ error: "Función mal configurada" }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  // ── Cuerpo ──────────────────────────────────────────────────────────────────
  let body: { texts?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const texts = body.texts;
  if (
    !Array.isArray(texts) ||
    texts.length === 0 ||
    !texts.every((t) => typeof t === "string" && t.length > 0)
  ) {
    return new Response(
      JSON.stringify({ error: "`texts` debe ser un array no vacío de strings" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  // Cota defensiva: evita abusar de la sesión con lotes enormes.
  if (texts.length > 256) {
    return new Response(
      JSON.stringify({ error: "Máximo 256 textos por petición" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  // ── Embeddings (gte-small, mean pooling + normalización L2 -> 384-dim) ────────
  const embeddings: number[][] = [];
  for (const text of texts as string[]) {
    const vector = (await session.run(text, {
      mean_pool: true,
      normalize: true,
    })) as number[];
    embeddings.push(vector);
  }

  return new Response(JSON.stringify({ embeddings }), {
    status: 200,
    headers: JSON_HEADERS,
  });
});
