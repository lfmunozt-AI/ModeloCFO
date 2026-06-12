import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Lista los hilos del usuario autenticado (más recientes primero). */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("No autorizado", { status: 401 });
  }

  const { data, error } = await supabase
    .from("threads")
    .select("id, title, created_at, user_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return new Response("No se pudieron cargar los hilos", { status: 500 });
  }

  return Response.json({ threads: data });
}

/** Crea un nuevo hilo para el usuario. */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("No autorizado", { status: 401 });
  }

  let title = "Nuevo hilo";
  try {
    const body = await req.json();
    if (typeof body?.title === "string" && body.title.trim()) {
      title = body.title.trim().slice(0, 120);
    }
  } catch {
    // Sin cuerpo: usamos el título por defecto.
  }

  const { data, error } = await supabase
    .from("threads")
    .insert({ user_id: user.id, title })
    .select("id, title, created_at, user_id")
    .single();

  if (error) {
    return new Response("No se pudo crear el hilo", { status: 500 });
  }

  return Response.json({ thread: data }, { status: 201 });
}
