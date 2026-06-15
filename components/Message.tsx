"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Role, FeedbackRating } from "@/lib/types";

interface MessageProps {
  role: Role;
  content: string;
  /** id real del mensaje (necesario para feedback). Ausente mientras streamea. */
  id?: string;
  threadId?: string | null;
  /** true si es la primera respuesta del hilo (primer intercambio). */
  isFirstSession?: boolean;
}

const MAX_COMMENT = 500;

/**
 * Burbuja de mensaje según el rol. El usuario va en texto plano; el asistente
 * se renderiza como Markdown y, si tiene id persistido, muestra los pulgares de
 * validación RLHF (👍/👎) con actualización optimista y comentario inline en 👎.
 */
export default function Message({
  role,
  content,
  id,
  threadId,
  isFirstSession,
}: MessageProps) {
  const isUser = role === "user";
  const canRate = role === "assistant" && !!id && !!content;

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[75ch] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "whitespace-pre-wrap bg-zinc-800 text-zinc-50"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800/60 dark:text-zinc-100"
        }`}
      >
        {content ? (
          isUser ? (
            content
          ) : (
            <div className="space-y-2 break-words [&_a]:underline [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] dark:[&_code]:bg-white/10 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/80 [&_pre]:p-3 [&_pre]:text-zinc-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-zinc-100 [&_ul]:list-disc [&_ul]:pl-5">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )
        ) : (
          <span className="opacity-40">…</span>
        )}
      </div>

      {canRate && (
        <FeedbackControls
          messageId={id!}
          threadId={threadId ?? null}
          isFirstSession={!!isFirstSession}
        />
      )}
    </div>
  );
}

/** Pulgares 👍/👎 + comentario inline. Estado local optimista, sin spinner. */
function FeedbackControls({
  messageId,
  threadId,
  isFirstSession,
}: {
  messageId: string;
  threadId: string | null;
  isFirstSession: boolean;
}) {
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [commentSent, setCommentSent] = useState(false);

  function send(r: FeedbackRating, withComment?: string) {
    // Fire-and-forget: el update visual ya ocurrió (optimista). Si la red falla,
    // no revertimos la selección (señal de bajo coste; no bloquea al usuario).
    void fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message_id: messageId,
        thread_id: threadId,
        rating: r,
        is_first_session: isFirstSession,
        ...(withComment ? { comment: withComment } : {}),
      }),
    }).catch(() => {});
  }

  function toggle(r: FeedbackRating) {
    if (rating === r) {
      // Deseleccionar: solo estado local (no hay POST de retracción).
      setRating(null);
      setShowComment(false);
      return;
    }
    setRating(r);
    setShowComment(r === "negative");
    setCommentSent(false);
    send(r);
  }

  function submitComment() {
    const c = comment.trim();
    if (!c || c.length > MAX_COMMENT) return;
    send("negative", c);
    setShowComment(false);
    setCommentSent(true);
  }

  const base =
    "rounded-md px-1.5 py-0.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-zinc-500";

  return (
    <div className="mt-1 max-w-[75ch] space-y-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => toggle("positive")}
          aria-pressed={rating === "positive"}
          aria-label="Respuesta útil"
          className={`${base} ${
            rating === "positive"
              ? "bg-emerald-100 dark:bg-emerald-900/40"
              : "opacity-50 hover:opacity-100"
          }`}
        >
          👍
        </button>
        <button
          type="button"
          onClick={() => toggle("negative")}
          aria-pressed={rating === "negative"}
          aria-label="Respuesta a mejorar"
          className={`${base} ${
            rating === "negative"
              ? "bg-red-100 dark:bg-red-900/40"
              : "opacity-50 hover:opacity-100"
          }`}
        >
          👎
        </button>
        {commentSent && (
          <span className="ml-1 text-xs text-zinc-400">Gracias por el detalle.</span>
        )}
      </div>

      {showComment && (
        <div className="flex items-start gap-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
            maxLength={MAX_COMMENT}
            rows={2}
            placeholder="¿Qué falló en esta respuesta?"
            aria-label="Comentario sobre la respuesta"
            className="max-h-32 flex-1 resize-none rounded-lg border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
          <button
            type="button"
            onClick={submitComment}
            disabled={!comment.trim()}
            className="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Enviar
          </button>
        </div>
      )}
    </div>
  );
}
