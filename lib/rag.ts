import type { RagChunk } from "./types";

/**
 * STUB de recuperación RAG. AG02 lo implementa (embeddings + búsqueda vectorial
 * sobre los documentos del usuario en Supabase / pgvector).
 *
 * Contrato estable para que el resto del esqueleto compile y funcione hoy:
 *   - recibe el id de usuario, el id de hilo y la query del usuario.
 *   - devuelve los fragmentos más relevantes (vacío por ahora).
 *
 * No cambiar la firma sin coordinar con AG02 y con app/api/chat/route.ts.
 */
export async function retrieveContext(
  _userId: string,
  _threadId: string,
  _query: string,
): Promise<RagChunk[]> {
  // TODO(AG02): embeddings de la query + match_documents() en Supabase.
  return [];
}

/** Aplana los fragmentos RAG en un bloque de texto para inyectar en el system prompt. */
export function formatContext(chunks: RagChunk[]): string {
  if (chunks.length === 0) return "";
  const body = chunks
    .map((c, i) => `[${i + 1}] (${c.source})\n${c.content}`)
    .join("\n\n");
  return `Contexto recuperado de los documentos del usuario:\n\n${body}`;
}
