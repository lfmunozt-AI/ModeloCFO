// Tipos compartidos del dominio. Mantener mínimo (regla 7: cero estadísticas/dashboards).

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  /** id real del mensaje persistido. Ausente mientras es optimista/streaming;
   *  necesario para enviar feedback RLHF (👍/👎). */
  id?: string;
  role: Role;
  content: string;
}

/** Valoración RLHF de una respuesta del asistente. */
export type FeedbackRating = "positive" | "negative";

export interface Thread {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  role: Role;
  content: string;
  created_at: string;
}

/** Fragmento de contexto devuelto por el RAG (lib/rag.ts). AG02 lo implementa. */
export interface RagChunk {
  content: string;
  source: string;
  score: number;
}

/** Estado de la ingesta de un documento (AG02). */
export type DocumentStatus = "processing" | "ready" | "error";

/** Documento del usuario (fuente del RAG). Lo expone GET /api/documents. */
export interface Document {
  id: string;
  name: string;
  status: DocumentStatus;
  created_at: string;
}
