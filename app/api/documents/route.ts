import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Documentos del usuario (fuente del RAG).
 *
 * GET  — lista los documentos del usuario. Funcional.
 * POST — ingesta de documentos. STUB: AG02 implementa el pipeline real
 *        (parseo + chunking + embeddings + almacenamiento vectorial).
 *        Se deja como 501 a propósito para no acoplar el esqueleto a una
 *        implementación de embeddings que es propiedad de AG02.
 */

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("No autorizado", { status: 401 });
  }

  const { data, error } = await supabase
    .from("documents")
    .select("id, name, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return new Response("No se pudieron cargar los documentos", {
      status: 500,
    });
  }

  return Response.json({ documents: data });
}

export async function POST() {
  // TODO(AG02): recibir archivo/texto, chunking, embeddings y guardado vectorial.
  return Response.json(
    {
      error: "No implementado",
      detail: "La ingesta de documentos la implementa AG02 (RAG).",
    },
    { status: 501 },
  );
}
