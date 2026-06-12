// Eventos de ventana para coordinar componentes de cliente sin acoplarlos
// (ChatWindow ↔ Sidebar) tras crear/reiniciar un hilo desde el chat.

/** La lista de hilos cambió (p. ej. se creó uno al enviar el primer mensaje). */
export const THREADS_CHANGED_EVENT = "modelocfo:threads-changed";

/** El usuario pidió un chat nuevo estando ya en /chat: reiniciar la ventana. */
export const NEW_CHAT_EVENT = "modelocfo:new-chat";
