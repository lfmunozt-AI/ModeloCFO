// Tipos compartidos del dominio. Mantener mínimo (regla 7: cero estadísticas/dashboards).

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

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
