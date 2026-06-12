import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ChatWindow from "@/components/ChatWindow";
import type { ChatMessage, Role } from "@/lib/types";

/** Vista de un hilo: carga mensajes en el servidor y monta la ventana de chat. */
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  // RLS garantiza que solo se devuelven hilos del usuario.
  const { data: thread } = await supabase
    .from("threads")
    .select("id, title")
    .eq("id", threadId)
    .single();
  if (!thread) notFound();

  const { data: messages } = await supabase
    .from("messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  const initialMessages: ChatMessage[] = (messages ?? []).map((m) => ({
    role: m.role as Role,
    content: m.content as string,
  }));

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-200 px-4 py-3 text-sm font-medium dark:border-zinc-800">
        {thread.title}
      </header>
      <div className="flex-1 overflow-hidden">
        <ChatWindow threadId={threadId} initialMessages={initialMessages} />
      </div>
    </div>
  );
}
