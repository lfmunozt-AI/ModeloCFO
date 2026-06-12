"use client";

import {
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { DOCUMENTS_CHANGED_EVENT } from "@/lib/chat-events";

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

type Upload =
  | { state: "idle" }
  | { state: "uploading"; name: string }
  | { state: "ready"; name: string; chunks: number }
  | { state: "error"; name: string; message: string };

const ACCEPT = ".pdf,.txt,.md,.markdown";

/**
 * Caja de entrada del chat. Enter envía, Shift+Enter inserta salto de línea.
 * El clip 📎 sube un documento a /api/documents (RAG); el estado de la ingesta
 * se muestra en un toast sobre la caja. La sidebar refresca su lista al recibir
 * DOCUMENTS_CHANGED_EVENT.
 */
export default function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [value, setValue] = useState("");
  const [upload, setUpload] = useState<Upload>({ state: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);
  const uploading = upload.state === "uploading";

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Permite re-subir el mismo archivo (el input no dispara change si no cambia).
    e.target.value = "";
    if (!file) return;

    setUpload({ state: "uploading", name: file.name });
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.status === "error") {
        const message =
          (typeof data?.error === "string" && data.error) ||
          "No se pudo procesar el documento";
        setUpload({ state: "error", name: file.name, message });
        return;
      }

      setUpload({
        state: "ready",
        name: file.name,
        chunks: typeof data?.chunks === "number" ? data.chunks : 0,
      });
      // Avisa a la sidebar para que refresque el panel de documentos.
      window.dispatchEvent(new CustomEvent(DOCUMENTS_CHANGED_EVENT));
    } catch {
      setUpload({
        state: "error",
        name: file.name,
        message: "Error de red al subir el documento",
      });
    }
  }

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800">
      {upload.state !== "idle" && (
        <div className="flex items-center gap-2 px-3 pt-2 text-xs">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              upload.state === "uploading"
                ? "animate-pulse bg-amber-500"
                : upload.state === "ready"
                  ? "bg-emerald-500"
                  : "bg-red-500"
            }`}
            aria-hidden
          />
          <span className="truncate text-zinc-500 dark:text-zinc-400">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {upload.name}
            </span>{" "}
            {upload.state === "uploading" && "· Procesando…"}
            {upload.state === "ready" &&
              `· Listo (${upload.chunks} ${
                upload.chunks === 1 ? "fragmento" : "fragmentos"
              })`}
            {upload.state === "error" && `· ${upload.message}`}
          </span>
          {upload.state !== "uploading" && (
            <button
              type="button"
              onClick={() => setUpload({ state: "idle" })}
              className="ml-auto shrink-0 rounded px-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              aria-label="Descartar aviso"
            >
              ✕
            </button>
          )}
        </div>
      )}

      <form onSubmit={submit} className="flex items-end gap-2 p-3">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          onChange={handleFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          aria-label="Adjuntar documento (PDF, TXT o MD)"
          title="Adjuntar documento (PDF, TXT o MD)"
          className="rounded-xl border border-zinc-300 p-2 text-zinc-600 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {uploading ? (
            <span className="block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          )}
        </button>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Escribe un mensaje…"
          disabled={disabled}
          aria-label="Mensaje"
          className="max-h-40 min-w-0 flex-1 resize-none rounded-xl border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
