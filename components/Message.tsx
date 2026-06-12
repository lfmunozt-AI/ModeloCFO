import ReactMarkdown from "react-markdown";
import type { Role } from "@/lib/types";

interface MessageProps {
  role: Role;
  content: string;
}

/**
 * Burbuja de mensaje según el rol. Presentacional.
 * El usuario va en texto plano (whitespace-pre-wrap); el asistente se renderiza
 * como Markdown (código, listas, negritas) con estilos acotados a la burbuja.
 */
export default function Message({ role, content }: MessageProps) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
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
            <div
              className="space-y-2 break-words [&_a]:underline [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] dark:[&_code]:bg-white/10 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/80 [&_pre]:p-3 [&_pre]:text-zinc-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-zinc-100 [&_ul]:list-disc [&_ul]:pl-5"
            >
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )
        ) : (
          <span className="opacity-40">…</span>
        )}
      </div>
    </div>
  );
}
