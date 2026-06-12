import ChatShell from "@/components/ChatShell";

/** Shell de la zona de chat: sidebar de hilos (responsive) + contenido. */
export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ChatShell>{children}</ChatShell>;
}
