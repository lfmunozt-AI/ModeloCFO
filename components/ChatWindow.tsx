"use client";

import { useEffect, useRef, useState } from "react";
import Message from "./Message";
import MessageInput from "./MessageInput";
import WelcomePanel from "./WelcomePanel";
import { THREADS_CHANGED_EVENT, NEW_CHAT_EVENT } from "@/lib/chat-events";
import type { ChatMessage, Role } from "@/lib/types";

interface ChatWindowProps {
  /** null = chat nuevo aún sin hilo; el hilo se crea con el primer mensaje. */
  threadId: string | null;
  initialMessages: ChatMessage[];
}

/**
 * Ventana de chat. Mantiene el estado de los mensajes, envía a /api/chat y
 * consume el stream SSE token a token actualizando la respuesta del asistente.
 *
 * Si arranca sin hilo (threadId null), el primer envío crea el hilo en el
 * servidor; el id llega en la cabecera X-Thread-Id y lo "adoptamos" actualizando
 * la URL con history.replaceState — sin navegación de Next, para no desmontar
 * este componente ni cortar el stream en curso (lo que abortaría la respuesta
 * del asistente antes de que el servidor la persista).
 *
 * Tras cerrar el stream, hidratamos los ids reales de los mensajes (GET del
 * hilo) para habilitar el feedback 👍/👎, que requiere el message_id persistido.
 */
export default function ChatWindow({
  threadId,
  initialMessages,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  // Hay un hilo materializado (entró con uno, o se creó con el 1er mensaje).
  const [hasThread, setHasThread] = useState(threadId !== null);
  // Primera sesión del usuario (sin hilos previos): habilita el WelcomePanel.
  const [firstSession, setFirstSession] = useState(false);
  // Hilo activo en esta sesión montada (puede pasar de null → id tras el 1er envío).
  const threadIdRef = useRef<string | null>(threadId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Detecta la primera sesión (GET /api/threads → total). Solo en la instancia
  // de "chat nuevo"; se reevalúa al pedir un chat nuevo (el usuario pudo crear
  // su primer hilo en el ínterin).
  useEffect(() => {
    if (threadId !== null) return;
    let active = true;
    async function loadFirstSession() {
      try {
        const res = await fetch("/api/threads");
        if (!res.ok) return;
        const { total } = (await res.json()) as { total?: number };
        if (active) setFirstSession((total ?? 0) === 0);
      } catch {
        // Sin red: no mostramos welcome (degradación silenciosa).
      }
    }
    loadFirstSession();

    function reset() {
      threadIdRef.current = null;
      setMessages([]);
      setStreaming(false);
      setHasThread(false);
      window.history.replaceState(null, "", "/chat");
      loadFirstSession();
    }
    window.addEventListener(NEW_CHAT_EVENT, reset);
    return () => {
      active = false;
      window.removeEventListener(NEW_CHAT_EVENT, reset);
    };
  }, [threadId]);

  async function handleSend(text: string) {
    setStreaming(true);
    // Optimista: añade el mensaje del usuario y un hueco para el asistente.
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: threadIdRef.current, message: text }),
      });

      if (!res.ok || !res.body) {
        throw new Error((await res.text()) || "Error en la respuesta");
      }

      // Adopta el hilo recién creado: actualiza la URL sin recargar y avisa a
      // la sidebar. El stream sigue vivo en este mismo componente montado.
      const returnedId = res.headers.get("X-Thread-Id");
      if (returnedId && !threadIdRef.current) {
        threadIdRef.current = returnedId;
        setHasThread(true);
        window.history.replaceState(null, "", `/chat/${returnedId}`);
        window.dispatchEvent(new CustomEvent(THREADS_CHANGED_EVENT));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Eventos SSE separados por línea en blanco.
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;

          try {
            const parsed = JSON.parse(payload) as {
              token?: string;
              error?: string;
            };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.token) appendToAssistant(parsed.token);
          } catch {
            // Ignora fragmentos no-JSON.
          }
        }
      }

      // Stream cerrado → la respuesta ya está persistida (onComplete se espera
      // antes de cerrar). Hidrata los ids reales para habilitar el feedback.
      await hydrateIds(threadIdRef.current);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Error desconocido";
      appendToAssistant(`\n\n⚠️ ${detail}`);
    } finally {
      setStreaming(false);
    }
  }

  function appendToAssistant(token: string) {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === "assistant") {
        next[next.length - 1] = {
          ...last,
          content: last.content + token,
        };
      }
      return next;
    });
  }

  // Reemplaza el estado optimista por el persistido (con ids reales). Solo si el
  // servidor devuelve al menos tantos mensajes como tenemos, para no perder
  // contenido recién mostrado ante una lectura parcial.
  async function hydrateIds(tid: string | null) {
    if (!tid) return;
    try {
      const res = await fetch(`/api/threads/${tid}`);
      if (!res.ok) return;
      const { messages: persisted } = (await res.json()) as {
        messages?: { id: string; role: Role; content: string }[];
      };
      if (!Array.isArray(persisted)) return;
      setMessages((prev) =>
        persisted.length >= prev.length
          ? persisted.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
            }))
          : prev,
      );
    } catch {
      // Si falla, conservamos el estado optimista (sin ids → sin feedback aún).
    }
  }

  // "Escribiendo…": el stream está abierto pero el asistente aún no emitió token.
  const last = messages[messages.length - 1];
  const waitingFirstToken =
    streaming && last?.role === "assistant" && last.content === "";

  // Primera respuesta del hilo (primer intercambio) → is_first_session.
  const firstAssistantIndex = messages.findIndex((m) => m.role === "assistant");

  const showWelcome = !hasThread && firstSession && messages.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          showWelcome ? null : (
            <div className="mt-12 px-4 text-center text-sm text-zinc-400">
              <p className="font-medium text-zinc-500 dark:text-zinc-400">
                Empieza a chatear con The Consigliere.
              </p>
              <p className="mt-1">
                Sube un documento con el clip 📎 para darme contexto, o escribe
                tu pregunta abajo.
              </p>
            </div>
          )
        ) : (
          messages.map((m, i) => {
            // Mientras esperamos el primer token, mostramos el indicador en vez
            // de la burbuja vacía del asistente.
            if (
              waitingFirstToken &&
              i === messages.length - 1 &&
              m.role === "assistant"
            ) {
              return <TypingIndicator key={i} />;
            }
            return (
              <Message
                key={m.id ?? i}
                role={m.role}
                content={m.content}
                id={m.id}
                threadId={threadIdRef.current}
                isFirstSession={i === firstAssistantIndex}
              />
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {showWelcome && (
        <WelcomePanel onStart={handleSend} disabled={streaming} />
      )}

      <MessageInput onSend={handleSend} disabled={streaming} />
    </div>
  );
}

/** Burbuja con tres puntos animados mientras el asistente "escribe…". */
function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div
        className="flex items-center gap-1 rounded-2xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800/60"
        role="status"
        aria-label="El asistente está escribiendo"
      >
        <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" />
      </div>
    </div>
  );
}
