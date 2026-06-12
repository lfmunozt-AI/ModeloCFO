import type { Role } from "@/lib/types";

interface MessageProps {
  role: Role;
  content: string;
}

/** Renderiza una burbuja de mensaje según el rol. Presentacional. */
export default function Message({ role, content }: MessageProps) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75ch] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-zinc-800 text-zinc-50"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800/60 dark:text-zinc-100"
        }`}
      >
        {content || <span className="opacity-40">…</span>}
      </div>
    </div>
  );
}
