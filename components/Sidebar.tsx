"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  THREADS_CHANGED_EVENT,
  NEW_CHAT_EVENT,
  DOCUMENTS_CHANGED_EVENT,
} from "@/lib/chat-events";
import type { Thread, Document, DocumentStatus } from "@/lib/types";

/**
 * Barra lateral: lista de hilos (renombrar/eliminar), panel colapsable de
 * documentos con su estado de ingesta, nuevo hilo y logout. Carga datos en el
 * cliente desde /api/threads y /api/documents.
 */
export default function Sidebar({
  onNavigate,
}: {
  /** Se invoca al navegar (cerrar el drawer en móvil). */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const params = useParams();
  const activeId = typeof params?.threadId === "string" ? params.threadId : null;

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  // Renombrado inline / menú por hilo.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);

  // Panel de documentos.
  const [documents, setDocuments] = useState<Document[]>([]);
  const [docsOpen, setDocsOpen] = useState(true);

  async function loadThreads() {
    const res = await fetch("/api/threads");
    if (res.ok) {
      const { threads } = (await res.json()) as { threads: Thread[] };
      setThreads(threads);
    }
    setLoading(false);
  }

  async function loadDocuments() {
    const res = await fetch("/api/documents");
    if (res.ok) {
      const { documents } = (await res.json()) as { documents: Document[] };
      setDocuments(documents);
    }
  }

  useEffect(() => {
    loadThreads();
    loadDocuments();
    window.addEventListener(THREADS_CHANGED_EVENT, loadThreads);
    window.addEventListener(DOCUMENTS_CHANGED_EVENT, loadDocuments);
    return () => {
      window.removeEventListener(THREADS_CHANGED_EVENT, loadThreads);
      window.removeEventListener(DOCUMENTS_CHANGED_EVENT, loadDocuments);
    };
  }, []);

  // Cierra el menú ⋯ al hacer clic fuera.
  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuId]);

  function newChat() {
    router.push("/chat");
    window.dispatchEvent(new CustomEvent(NEW_CHAT_EVENT));
    onNavigate?.();
  }

  async function logout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function startRename(t: Thread) {
    setMenuId(null);
    setEditingId(t.id);
    setEditValue(t.title);
  }

  async function commitRename(id: string) {
    const title = editValue.trim();
    setEditingId(null);
    const current = threads.find((t) => t.id === id);
    if (!title || title === current?.title) return;
    // Optimista.
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, title } : t)),
    );
    const res = await fetch(`/api/threads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) loadThreads(); // Revierte recargando del servidor.
  }

  async function removeThread(t: Thread) {
    setMenuId(null);
    if (!window.confirm(`¿Eliminar el hilo «${t.title}»? No se puede deshacer.`))
      return;
    setThreads((prev) => prev.filter((x) => x.id !== t.id));
    const res = await fetch(`/api/threads/${t.id}`, { method: "DELETE" });
    if (!res.ok) {
      loadThreads();
      return;
    }
    if (activeId === t.id) router.push("/chat");
  }

  return (
    <aside className="flex h-full w-64 max-w-[80vw] flex-col border-r border-zinc-800 bg-zinc-950 text-zinc-100">
      <div className="p-3">
        <button
          onClick={newChat}
          className="w-full rounded-xl border border-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-500"
        >
          + Nuevo hilo
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        {loading ? (
          <p className="px-3 py-2 text-xs text-zinc-500">Cargando…</p>
        ) : threads.length === 0 ? (
          <p className="px-3 py-2 text-xs text-zinc-500">
            Sin hilos todavía. Escribe un mensaje para empezar.
          </p>
        ) : (
          threads.map((t) =>
            editingId === t.id ? (
              <input
                key={t.id}
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => commitRename(t.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename(t.id);
                  } else if (e.key === "Escape") {
                    setEditingId(null);
                  }
                }}
                className="w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                aria-label="Nuevo nombre del hilo"
              />
            ) : (
              <div key={t.id} className="group relative flex items-center">
                <Link
                  href={`/chat/${t.id}`}
                  onClick={() => onNavigate?.()}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    startRename(t);
                  }}
                  className={`block flex-1 truncate rounded-lg py-2 pl-3 pr-8 text-sm ${
                    activeId === t.id
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  {t.title}
                </Link>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuId(menuId === t.id ? null : t.id);
                  }}
                  aria-label="Opciones del hilo"
                  aria-haspopup="menu"
                  className="absolute right-1 rounded-md px-2 py-1 text-zinc-400 opacity-0 hover:bg-zinc-700 hover:text-zinc-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-zinc-500 group-hover:opacity-100 aria-expanded:opacity-100"
                  aria-expanded={menuId === t.id}
                >
                  ⋯
                </button>
                {menuId === t.id && (
                  <div
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-1 top-9 z-10 w-32 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 text-sm shadow-lg"
                  >
                    <button
                      role="menuitem"
                      onClick={() => startRename(t)}
                      className="block w-full px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-800"
                    >
                      Renombrar
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => removeThread(t)}
                      className="block w-full px-3 py-1.5 text-left text-red-400 hover:bg-zinc-800"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            ),
          )
        )}
      </nav>

      <DocumentsPanel
        documents={documents}
        open={docsOpen}
        onToggle={() => setDocsOpen((o) => !o)}
      />

      <div className="border-t border-zinc-800 p-3">
        <button
          onClick={logout}
          className="w-full rounded-xl px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-500"
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}

const STATUS_STYLE: Record<DocumentStatus, { dot: string; label: string }> = {
  processing: { dot: "bg-amber-500 animate-pulse", label: "Procesando" },
  ready: { dot: "bg-emerald-500", label: "Listo" },
  error: { dot: "bg-red-500", label: "Error" },
};

/** Sección colapsable con los documentos del usuario y su estado de ingesta. */
function DocumentsPanel({
  documents,
  open,
  onToggle,
}: {
  documents: Document[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-t border-zinc-800">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-zinc-500"
      >
        <span>Documentos ({documents.length})</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="max-h-48 overflow-y-auto px-2 pb-2">
          {documents.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-600">
              Sube un documento para darme contexto…
            </li>
          ) : (
            documents.map((d) => {
              const s = STATUS_STYLE[d.status] ?? STATUS_STYLE.processing;
              return (
                <li
                  key={d.id}
                  className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-zinc-300"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`}
                    title={s.label}
                    aria-hidden
                  />
                  <span className="truncate" title={d.name}>
                    {d.name}
                  </span>
                  <span className="sr-only">{s.label}</span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
