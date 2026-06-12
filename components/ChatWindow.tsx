"use client";

import { useEffect, useRef, useState } from "react";
import Message from "./Message";
import MessageInput from "./MessageInput";
import type { ChatMessage } from "@/lib/types";

interface ChatWindowProps {
  threadId: string;
  initialMessages: ChatMessage[];
}

/**
 * Ventana de chat. Mantiene el estado de los mensajes, envía a /api/chat y
 * consume el stream SSE token a token actualizando la respuesta del asistente.
 */
export default function ChatWindow({
  threadId,
  initialMessages,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        body: JSON.stringify({ threadId, message: text }),
      });

      if (!res.ok || !res.body) {
        throw new Error((await res.text()) || "Error en la respuesta");
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
