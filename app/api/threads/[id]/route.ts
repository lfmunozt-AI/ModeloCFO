import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Gestión de un hilo concreto del usuario.
 *
 * GET    — mensajes del hilo (id, role, content) en orden cronológico. El cliente
 *          lo usa para hidratar los ids reales tras crear/responder un mensaje
 *          por streaming (el id habilita el feedback 👍/👎).
 * PATCH  — renombra el hilo ({ title }).
 * DELETE — elimina el hilo (sus mensajes caen por ON DELETE CASCADE).
 *
 * Seguridad: se valida la sesión con getUser() y se filtra por user_id; la RLS
 * (`threads_owner`, FOR ALL) hace de red de seguridad. Nunca se acepta user_id
 * del cliente.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("No autorizado", { status: 401 });
  }

  // Comprueba propiedad del hilo (filtro explícito + RLS). Sin fila → 404, sin
  // revelar si existe pero es de otro usuario.
  const { data: thread } = await supabase
    .from("threads")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!thread) {
    return new Response("Hilo no encontrado", { status: 404 });
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content")
    .eq("thread_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return new Response("No se pudieron cargar los mensajes", { status: 500 });
  }

  return Response.json({ messages: data ?? [] });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("No autorizado", { status: 401 });
  }

  let title: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.title === "string" && body.title.trim()) {
      title = body.title.trim().slice(0, 120);
    }
  } catch {
    // Cuerpo inválido: cae al 400 de abajo.
  }
  if (!title) {
    return Response.json({ error: "Falta el título" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("threads")
    .update({ title })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, title, created_at, user_id")
    .maybeSingle();

  if (error) {
    return new Response("No se pudo renombrar el hilo", { status: 500 });
  }
  // Sin fila: el hilo no existe o no es del usuario (RLS lo oculta). No es un
  // error del servidor → 404, nunca 500. No revela si existe pero es de otro.
  if (!data) {
    return new Response("Hilo no encontrado", { status: 404 });
  }

  return Response.json({ thread: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("No autorizado", { status: 401 });
  }

  // `select()` tras el delete devuelve las filas afectadas: si está vacío, no se
  // borró nada porque el hilo no existe o es de otro usuario (RLS lo filtra).
  const { data, error } = await supabase
    .from("threads")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    return new Response("No se pudo eliminar el hilo", { status: 500 });
  }
  if (!data || data.length === 0) {
    return new Response("Hilo no encontrado", { status: 404 });
  }

  return new Response(null, { status: 204 });
}
