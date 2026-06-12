"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Thread } from "@/lib/types";

/**
 * Barra lateral con la lista de hilos, botón de nuevo hilo y logout.
 * Carga los hilos desde /api/threads en el cliente.
 */
export default function Sidebar() {
  const router = useRouter();
  const params = useParams();
  const activeId = typeof params?.threadId === "string" ? params.threadId : null;

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function loadThreads() {
    const res = await fetch("/api/threads");
    if (res.ok) {
      const { threads } = (await res.json()) as { threads: Thread[] };
      setThreads(threads);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadThreads();
  }, []);

  async function createThread() {
    setCreating(true);
    const res = await fetch("/api/threads", { method: "POST" });
    setCreating(false);
    if (res.ok) {
      const { thread } = (await res.json()) as { thread: Thread };
      setThreads((prev) => [thread, ...prev]);
      router.push(`/chat/${thread.id}`);
    }
  }

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-zinc-800 bg-zinc-950 text-zinc-100">
      <div className="p-3">
        <button
          onClick={createThread}
          disabled={creating}
          className="w-full rounded-xl border border-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
        >
          {creating ? "Creando…" : "+ Nuevo hilo"}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        {loading ? (
          <p className="px-3 py-2 text-xs text-zinc-500">Cargando…</p>
        ) : threads.length === 0 ? (
          <p className="px-3 py-2 text-xs text-zinc-500">Sin hilos todavía.</p>
        ) : (
          threads.map((t) => (
            <Link
              key={t.id}
              href={`/chat/${t.id}`}
              className={`block truncate rounded-lg px-3 py-2 text-sm ${
                activeId === t.id
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-300 hover:bg-zinc-900"
              }`}
            >
              {t.title}
            </Link>
          ))
        )}
      </nav>

      <div className="border-t border-zinc-800 p-3">
        <button
          onClick={logout}
          className="w-full rounded-xl px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
