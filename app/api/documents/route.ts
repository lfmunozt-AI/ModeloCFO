import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ingestDocument, type DocumentKind } from "@/lib/rag";

/**
 * Documentos del usuario (fuente del RAG).
 *
 * GET  — lista los documentos del usuario (incluye estado de la ingesta).
 * POST — ingesta real (AG02): recibe un archivo (multipart/form-data, campo
 *        `file`), valida sesión, tamaño y tipo, crea la fila en `documents`
 *        y ejecuta el pipeline de chunking + embeddings (gte-small/pgvector).
 *
 * Runtime Node (por defecto): la ingesta parsea PDF (unpdf) y no necesita edge.
 */

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Tipos aceptados → clase de parseo. Aceptamos por extensión y por MIME, porque
// los navegadores reportan los .md de forma inconsistente (text/plain o vacío).
const EXT_KIND: Record<string, DocumentKind> = {
  pdf: "pdf",
  txt: "txt",
  md: "md",
  markdown: "md",
};
const MIME_KIND: Record<string, DocumentKind> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
};

function resolveKind(name: string, mime: string): DocumentKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_KIND[ext] ?? MIME_KIND[mime] ?? null;
}

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
    .select("id, name, status, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return new Response("No se pudieron cargar los documentos", {
      status: 500,
    });
  }

  return Response.json({ documents: data });
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("No autorizado", { status: 401 });
  }

  // Token para autenticar la Edge Function `embed` (verifica JWT).
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return new Response("Sesión inválida", { status: 401 });
  }

  // Parseo del multipart.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { error: "Se esperaba multipart/form-data con un campo `file`" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Falta el archivo (`file`)" }, { status: 400 });
  }

  if (file.size === 0) {
    return Response.json({ error: "El archivo está vacío" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "El archivo supera el límite de 5 MB" },
      { status: 413 },
    );
  }

  const kind = resolveKind(file.name, file.type);
  if (!kind) {
    return Response.json(
      { error: "Tipo no soportado. Solo PDF, TXT o MD." },
      { status: 415 },
    );
  }

  const data = await file.arrayBuffer();

  // Crea la fila del documento (status 'processing' por defecto).
  const { data: doc, error: insertErr } = await supabase
    .from("documents")
    .insert({ user_id: user.id, name: file.name, status: "processing" })
    .select("id")
    .single();
  if (insertErr || !doc) {
    return new Response("No se pudo registrar el documento", { status: 500 });
  }

  // Ejecuta el pipeline. Para 5 usuarios y ≤5 MB, lo resolvemos en la request:
  // el documento queda 'ready' (o 'error') al responder.
  try {
    const result = await ingestDocument({
      supabase,
      accessToken: session.access_token,
      userId: user.id,
      documentId: doc.id,
      kind,
      data,
    });
    return Response.json(
      { id: doc.id, name: file.name, status: result.status, chunks: result.chunks },
      { status: 201 },
    );
  } catch (err) {
    console.error("Ingesta de documento falló:", err);
    return Response.json(
      { id: doc.id, status: "error", error: "Falló la ingesta del documento" },
      { status: 500 },
    );
  }
}
