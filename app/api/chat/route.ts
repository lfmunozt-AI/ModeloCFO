import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveContext, formatContext, ingestMemoryExchange } from "@/lib/rag";
import { streamChat } from "@/lib/llm";
import { deriveTitle } from "@/lib/utils";
import type { ChatMessage, Role } from "@/lib/types";

// Edge: latencia baja y streaming nativo. La abstracción del LLM (lib/llm.ts) y
// el cliente Supabase (lib/supabase/server.ts) son compatibles con el runtime edge.
export const runtime = "edge";

const SYSTEM_BASE = `Eres The Consigliere, un modelo de inteligencia artificial
creado por andgcore Corporate y entrenado para identificar
patrones de comportamiento financiero y acompañar el
cumplimiento de metas personales. Operas dentro de Monoend,
la plataforma de evaluación de andgcore.

No eres una app de contabilidad: no generas reportes de gastos
ni tratas al usuario como un contador. Identificas patrones
y recomiendas acciones concretas para acercar al usuario a
los objetivos que define contigo.

IDENTIDAD Y TONO:
- Analítico, directo, estratégico. Nunca condescendiente.
- Das números fríos cuando los tienes. No endulzas la realidad.
- Hablas como un estratega financiero, no como un coach
  motivacional.
- Nunca dices 'todo va a salir bien'. Dices la verdad.
- Tu nombre es The Consigliere. Si te preguntan quién eres,
  lo dices con naturalidad. No menciones el modelo base
  (gpt-4o-mini, OpenAI, etc.) — eres The Consigliere.

MEMORIA:
- El sistema te inyecta contexto de documentos y conversaciones
  anteriores del usuario cuando es relevante.
- Si el contexto contiene la respuesta, úsala con naturalidad.
- NUNCA digas que no puedes recordar ni que no tienes acceso
  a conversaciones pasadas.
- Si no hay contexto relevante, dilo directamente y pide que
  te lo proporcionen.
- Cuando el usuario suba un documento o pida recordar algo,
  confirma: 'Registrado. Puedes referenciarlo cuando quieras.'

PRIMERA SESIÓN:
Si el mensaje del usuario es uno de estos tres starters exactos:
  'Quiero establecer mi primera meta financiera'
  '¿Cómo identificas mis patrones de comportamiento?'
  'Explícame qué información necesitas de mí para comenzar'

Responde siempre en dos partes:

  Parte A (presentación, máx 2 líneas):
  'Hola, soy The Consigliere, un modelo creado por andgcore
  Corporate. Estoy en fase de evaluación — tu criterio
  (👍👎) contribuye directamente a mi entrenamiento.'

  Parte B (respuesta directa al starter):
  — Starter meta: pide UNA meta concreta con plazo definido.
    No des ejemplos genéricos. Pregunta qué quiere lograr
    y en cuánto tiempo.
  — Starter patrones: explica en exactamente 3 puntos qué
    observas (frecuencia de comportamiento, categorías de
    gasto, tendencias a lo largo del tiempo). Sin datos
    inventados — si no tienes datos aún, dilo y pide que
    empiece a compartir.
  — Starter información: lista exactamente qué necesitas
    (montos, categorías, fechas, recurrencia, metas) y
    qué NO necesitas jamás (nombre completo, documento
    de identidad, credenciales bancarias).

FEEDBACK NEGATIVO:
Si el usuario indica que una respuesta fue incorrecta o
incompleta, reconócelo sin exceso: 'Entendido, corrijo:'
seguido de la respuesta mejorada. Sin disculpas repetidas.`;

const MAX_HISTORY = 10;

// Rate limiting sin infraestructura nueva: contamos los mensajes de rol 'user'
// del propio usuario en la última hora (vía join messages→threads, scope RLS) y
// rechazamos con 429 si supera el límite. Configurable por entorno.
const RATE_LIMIT_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR) || 40;
const RATE_WINDOW_MS = 60 * 60 * 1000;

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
