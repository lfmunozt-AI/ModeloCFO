"use client";

import { useEffect, useRef, useState } from "react";
import Message from "./Message";
import MessageInput from "./MessageInput";
import { THREADS_CHANGED_EVENT, NEW_CHAT_EVENT } from "@/lib/chat-events";
import type { ChatMessage } from "@/lib/types";

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
 */
export default function ChatWindow({
  threadId,
  initialMessages,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  // Hilo activo en esta sesión montada (puede pasar de null → id tras el 1er envío).
  const threadIdRef = useRef<string | null>(threadId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Solo la instancia de "chat nuevo" (sin hilo de partida) se reinicia cuando
  // el usuario pulsa "Nuevo hilo" estando ya en /chat.
  useEffect(() => {
    if (threadId !== null) return;
    function reset() {
      threadIdRef.current = null;
      setMessages([]);
      setStreaming(false);
      window.history.replaceState(null, "", "/chat");
    }
    window.addEventListener(NEW_CHAT_EVENT, reset);
    return () => window.removeEventListener(NEW_CHAT_EVENT, reset);
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="mt-10 text-center text-sm text-zinc-400">
            Empieza la conversación escribiendo abajo.
          </p>
        ) : (
          messages.map((m, i) => (
            <Message key={i} role={m.role} content={m.content} />
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <MessageInput onSend={handleSend} disabled={streaming} />
    </div>
  );
}
