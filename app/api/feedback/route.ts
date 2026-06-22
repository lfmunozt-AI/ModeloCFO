import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Señales de feedback RLHF (👍/👎 + comentario opcional) sobre respuestas del
 * asistente. Alimenta el reentrenamiento del modelo.
 *
 * POST { message_id, thread_id, rating, comment?, is_first_session? } → 201 { ok }
 *
 * Seguridad: la identidad sale SIEMPRE de getUser() — nunca se acepta user_id
 * del cliente. Se verifica que el mensaje pertenece al usuario (join
 * messages→threads filtrando por su user_id) antes de registrar nada.
 *
 * La tabla `feedback_signals` la provee AG02C. Si aún no existe, respondemos 503
 * con un mensaje claro en vez de un 500 opaco.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_COMMENT = 500;

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("No autorizado", { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { message_id, thread_id, rating, comment, is_first_session } = body;

  if (typeof message_id !== "string" || !UUID.test(message_id)) {
    return Response.json({ error: "message_id inválido" }, { status: 400 });
  }
  if (typeof thread_id !== "string" || !UUID.test(thread_id)) {
    return Response.json({ error: "thread_id inválido" }, { status: 400 });
  }
  if (rating !== "positive" && rating !== "negative") {
    return Response.json(
      { error: "rating debe ser 'positive' o 'negative'" },
      { status: 400 },
    );
  }
  let commentClean: string | null = null;
  if (comment !== undefined && comment !== null) {
    if (typeof comment !== "string") {
      return Response.json({ error: "comment inválido" }, { status: 400 });
    }
    if (comment.length > MAX_COMMENT) {
      return Response.json(
        { error: `comment supera ${MAX_COMMENT} caracteres` },
        { status: 400 },
      );
    }
    commentClean = comment.trim() || null;
  }
  const isFirstSession = is_first_session === true;

  // Verifica propiedad: el mensaje debe colgar de un hilo del usuario. La RLS de
  // `messages` ya lo restringe, pero filtramos explícitamente (defensa en capas).
  const { data: msg, error: msgErr } = await supabase
    .from("messages")
    .select("id, thread_id, threads!inner(user_id)")
    .eq("id", message_id)
    .eq("threads.user_id", user.id)
    .maybeSingle();

  if (msgErr) {
    return new Response("No se pudo verificar el mensaje", { status: 500 });
  }
  if (!msg || (msg as { thread_id?: string }).thread_id !== thread_id) {
    // No existe, es de otro usuario, o el thread_id no concuerda → 404 sin
    // distinguir el caso (no se revela la existencia de mensajes ajenos).
    return new Response("Mensaje no encontrado", { status: 404 });
  }

  const { error: insErr } = await supabase.from("feedback_signals").insert({
    user_id: user.id,
    message_id,
    thread_id,
    rating,
    comment: commentClean,
    is_first_session: isFirstSession,
  });

  if (insErr) {
    // Tabla ausente (AG02C aún no la creó): 503 explícito, no 500 opaco.
    const code = (insErr as { code?: string }).code;
    const message = (insErr as { message?: string }).message ?? "";
    if (
      code === "42P01" ||
      code === "PGRST205" ||
      /does not exist|schema cache|could not find the table/i.test(message)
    ) {
      return Response.json(
        {
          error:
            "El registro de feedback aún no está disponible (tabla feedback_signals pendiente de AG02C).",
        },
        { status: 503 },
      );
    }
    return Response.json(
      { error: "No se pudo registrar el feedback" },
      { status: 500 },
    );
  }

  return Response.json({ ok: true }, { status: 201 });
}
