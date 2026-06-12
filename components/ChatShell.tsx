"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";

/**
 * Shell responsive del chat. En pantallas md+ la sidebar es estática; en móvil
 * (<768px, hasta 360px) se convierte en un drawer deslizable con overlay,
 * abierto por el botón ☰ de la barra superior móvil.
 */
export default function ChatShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <div
        className={`fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar onNavigate={() => setOpen(false)} />
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          aria-hidden
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 md:hidden dark:border-zinc-800">
          <button
            onClick={() => setOpen(true)}
            aria-label="Abrir menú"
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-lg leading-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700"
          >
            ☰
          </button>
          <span className="text-sm font-medium">ModeloCFO</span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </main>
    </div>
  );
}
