import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveContext, formatContext, ingestMemoryExchange } from "@/lib/rag";
import { streamChat } from "@/lib/llm";
import type { ChatMessage, Role } from "@/lib/types";

// Edge: latencia baja y streaming nativo. La abstracción del LLM (lib/llm.ts) y
// el cliente Supabase (lib/supabase/server.ts) son compatibles con el runtime edge.
export const runtime = "edge";

const SYSTEM_BASE = [
  "Eres ModeloCFO, un asistente financiero conversacional.",
  "Respondes en español, de forma clara, directa y honesta.",
  "Dispones de memoria del usuario: el sistema te inyecta contexto recuperado de",
  "sus documentos y de conversaciones anteriores cuando es relevante a la pregunta.",
  "Si el contexto contiene la respuesta, úsala con naturalidad. NUNCA digas que no",
  "puedes recordar ni que no tienes acceso a conversaciones pasadas; si no hay",
  "contexto relevante, di que aún no tienes ese dato y sugiere al usuario",
  "mencionarlo de nuevo o subirlo como documento.",
  "Si el usuario sube un documento o te pide recordar algo (ej: 'recuerda este",
  "estado de cuenta', 'guarda este dato'), confirma con naturalidad: 'Listo, ya",
  "tengo esa información en mi memoria para cuando la necesites.'",
  "No expliques mecanismos técnicos de almacenamiento.",
].join(" ");

const MAX_HISTORY = 10;
const TITLE_MAX_WORDS = 6;
const TITLE_MAX_CHARS = 40;

// Rate limiting sin infraestructura nueva: contamos los mensajes de rol 'user'
// del propio usuario en la última hora (vía join messages→threads, scope RLS) y
// rechazamos con 429 si supera el límite. Configurable por entorno.
const RATE_LIMIT_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR) || 40;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/** Título del hilo a partir del primer mensaje: ~6 primeras palabras, máx 40 chars. */
function deriveTitle(message: string): string {
  const words = message.trim().split(/\s+/).slice(0, TITLE_MAX_WORDS).join(" ");
  return words.length > TITLE_MAX_CHARS
    ? words.slice(0, TITLE_MAX_CHARS).trimEnd()
    : words;
}

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

  const { threadId: incomingThreadId, message } = body;
  if (typeof message !== "string" || !message.trim()) {
    return new Response("message es obligatorio", { status: 400 });
  }

  // Rate limiting: cuenta los mensajes 'user' del usuario en la última hora.
  // `threads!inner` + filtro por user_id garantiza el conteo solo de SUS hilos
  // (además del scope RLS). Se hace antes de crear hilo/persistir/llamar al LLM,
  // así un usuario limitado no genera hilos vacíos ni gasto de inferencia.
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count: recentCount } = await supabase
    .from("messages")
    .select("id, threads!inner(user_id)", { count: "exact", head: true })
    .eq("threads.user_id", user.id)
    .eq("role", "user")
    .gte("created_at", since);

  if ((recentCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return new Response(
      `Has alcanzado el límite de ${RATE_LIMIT_PER_HOUR} mensajes por hora. ` +
        "Espera unos minutos antes de enviar más.",
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  // threadId opcional: si no viene, creamos el hilo al vuelo con título
  // derivado del primer mensaje (así no existen hilos vacíos en la DB).
  let threadId: string;
  if (incomingThreadId) {
    // El hilo debe pertenecer al usuario (RLS lo refuerza; comprobamos para un 404 claro).
    const { data: thread, error: threadErr } = await supabase
      .from("threads")
      .select("id")
      .eq("id", incomingThreadId)
      .eq("user_id", user.id)
      .single();

    if (threadErr || !thread) {
      return new Response("Hilo no encontrado", { status: 404 });
    }
    threadId = thread.id;
  } else {
    const { data: created, error: createErr } = await supabase
      .from("threads")
      .insert({ user_id: user.id, title: deriveTitle(message) })
      .select("id")
      .single();

    if (createErr || !created) {
      return new Response("No se pudo crear el hilo", { status: 500 });
    }
    threadId = created.id;
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

  // 3) Contexto RAG real (AG02): embeddings de la consulta + match_chunks.
  //    El contenido recuperado se inyecta delimitado como dato no confiable.
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
        // Memoria conversacional (AG02): embebe el par Usuario/Asistente como
        // recuerdo recuperable en hilos futuros. fire-and-forget — nunca lanza y
        // los tokens ya se enviaron al usuario, así que no bloquea su stream.
        await ingestMemoryExchange(supabase, user.id, threadId, message, fullText);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // El cliente lo usa para adoptar el hilo recién creado sin recargar.
      "X-Thread-Id": threadId,
    },
  });
}
