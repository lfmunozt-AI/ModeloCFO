import ChatWindow from "@/components/ChatWindow";

// Chat nuevo: input activo desde el inicio. El hilo se crea en el servidor con
// el primer mensaje (threadId null → ver components/ChatWindow + api/chat).
export default function ChatIndexPage() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-200 px-4 py-3 text-sm font-medium dark:border-zinc-800">
        Nueva conversación
      </header>
      <div className="flex-1 overflow-hidden">
        <ChatWindow threadId={null} initialMessages={[]} />
      </div>
    </div>
  );
}
