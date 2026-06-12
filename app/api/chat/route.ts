import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveContext, formatContext } from "@/lib/rag";
import { streamChat } from "@/lib/llm";
import type { ChatMessage, Role } from "@/lib/types";

// Edge: latencia baja y streaming nativo. La abstracción del LLM (lib/llm.ts) y
// el cliente Supabase (lib/supabase/server.ts) son compatibles con el runtime edge.
export const runtime = "edge";

const SYSTEM_BASE = [
  "Eres ModeloCFO, un asistente financiero conversacional.",
  "Respondes en español, de forma clara, directa y honesta.",
  "Si no tienes datos suficientes en el contexto, dilo en lugar de inventar.",
].join(" ");

const MAX_HISTORY = 10;

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("No autorizado", { status: 401 });
  }

  let body: { threadId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Cuerpo JSON inválido", { status: 400 });
  }

  const { threadId, message } = body;
  if (!threadId || typeof message !== "string" || !message.trim()) {
    return new Response("threadId y message son obligatorios", { status: 400 });
  }

  // El hilo debe pertenecer al usuario (RLS lo refuerza; comprobamos para un 404 claro).
  const { data: thread, error: threadErr } = await supabase
    .from("threads")
    .select("id")
    .eq("id", threadId)
    .eq("user_id", user.id)
    .single();

  if (threadErr || !thread) {
    return new Response("Hilo no encontrado", { status: 404 });
  }

  // 1) Persiste el mensaje del usuario.
  const { error: userInsertErr } = await supabase.from("messages").insert({
    thread_id: threadId,
    role: "user",
    content: message.trim(),
  });
  if (userInsertErr) {
    return new Response("No se pudo guardar el mensaje", { status: 500 });
  }

  // 2) Recupera los últimos N mensajes (incluye el recién insertado).
  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY);

  const recent: ChatMessage[] = (history ?? [])
    .reverse()
    .map((m) => ({ role: m.role as Role, content: m.content as string }));

  // 3) Contexto RAG (stub de AG02 por ahora).
  const chunks = await retrieveContext(user.id, threadId, message);
  const context = formatContext(chunks);
  const systemPrompt = context ? `${SYSTEM_BASE}\n\n${context}` : SYSTEM_BASE;

  // 4) Stream del LLM; persiste la respuesta del asistente al finalizar.
  const stream = await streamChat(recent, systemPrompt, {
    onComplete: async (fullText) => {
      if (fullText.trim()) {
        await supabase.from("messages").insert({
          thread_id: threadId,
          role: "assistant",
          content: fullText,
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
