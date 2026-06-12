# Control de cambios — AG04 · UX / Frontend

| Campo | Valor |
|---|---|
| Agente | AG04 — UX / Frontend |
| Rama | agent/04-ux |
| Worktree | wt-modelocfo-ag04 |
| Fecha | 2026-06-13 |
| Estado | PR draft |

## Alcance ejecutado
Pulido de la UI minimalista sobre el esqueleto de AG01 + el RAG de AG02. Subida
de documentos desde el chat (clip 📎) con toast de estado, panel colapsable de
documentos en la sidebar con badges de estado, render Markdown de las respuestas
del asistente, gestión de hilos (renombrar/eliminar) con su API, estado de éxito
en verde en el login, y pulido general (indicador "escribiendo…", auto-scroll,
estados vacíos guía, responsive hasta 360px con drawer móvil, foco accesible).
Única dependencia nueva: `react-markdown`. No se tocó backend de chat/documentos,
`lib/llm.ts`, `lib/rag.ts`, migraciones ni la Edge Function.

## Archivos clave creados/modificados
- `components/MessageInput.tsx` — botón de clip 📎: selector `.pdf,.txt,.md`,
  sube a `POST /api/documents`, toast con estado (Procesando→Listo (N fragmentos)
  /Error), deshabilitado mientras sube, errores de la API visibles. Enter envía /
  Shift+Enter salto de línea (ya existía). Emite `DOCUMENTS_CHANGED_EVENT` al subir.
- `components/Sidebar.tsx` — gestión de hilos: renombrar (doble clic o menú ⋯,
  inline, Enter guarda / Esc cancela, optimista) y eliminar con confirmación;
  panel colapsable "Documentos" con `GET /api/documents` y badge de estado
  (processing=ámbar, ready=verde, error=rojo), refresco tras cada subida. Acepta
  `onNavigate` para cerrar el drawer móvil.
- `components/Message.tsx` — Markdown en las respuestas del asistente
  (`react-markdown`: código, listas, negritas, enlaces) con estilos acotados a la
  burbuja; los mensajes del usuario siguen en texto plano.
- `components/ChatWindow.tsx` — indicador "escribiendo…" (tres puntos) mientras el
  stream está abierto sin primer token; estado vacío con texto guía ("Sube un
  documento… o escribe tu pregunta"). Auto-scroll ya existía.
- `components/ChatShell.tsx` (nuevo) — shell responsive: sidebar estática en md+,
  drawer deslizable con overlay en móvil (≤360px) abierto por barra superior ☰.
- `app/chat/layout.tsx` — usa `ChatShell` en vez del flex estático.
- `app/api/threads/[id]/route.ts` (nuevo) — `PATCH` (renombrar) y `DELETE` del
  hilo; valida sesión con `getUser()`, filtra por `user_id` (nunca lo acepta del
  cliente), RLS como red de seguridad. Los mensajes caen por ON DELETE CASCADE.
- `app/login/page.tsx` — estado `success` (verde) separado del `error` (rojo): el
  mensaje "Cuenta creada, inicia sesión." ya no reutiliza el ámbar de error.
- `lib/types.ts` — `Document` + `DocumentStatus`.
- `lib/chat-events.ts` — `DOCUMENTS_CHANGED_EVENT` (chat → sidebar).
- `package.json` — `react-markdown` (única dependencia nueva permitida).

## Decisiones técnicas tomadas
1. **Drawer móvil en `ChatShell` (client) en vez de tocar las páginas server.**
   La sidebar es `w-64`; en 360px dejaría el chat inutilizable. Se extrajo el
   shell a un componente cliente con drawer + overlay (md:static en escritorio).
   Las páginas siguen siendo server components y conservan su `<header>`.
2. **Subida gestionada dentro de `MessageInput`.** El estado de la ingesta (toast)
   es local al input; al terminar emite un evento de ventana para que la sidebar
   refresque su panel, sin acoplar ambos componentes (mismo patrón que AG01 usó
   para ChatWindow↔Sidebar).
3. **Renombrado optimista con revert.** PATCH inline; si la API falla se recarga
   la lista del servidor. Eliminar usa `window.confirm` (minimalismo, sin modal).
4. **Markdown solo en el asistente.** El usuario queda en `whitespace-pre-wrap`
   (texto plano) — coherente con tratar su entrada como dato, no como markup.
5. **API de hilos por `[id]`**: no se acepta `user_id` del cliente; se filtra por
   `user.id` de `getUser()` y la política `threads_owner` (FOR ALL) cubre UPDATE/
   DELETE. No se tocaron migraciones (el esquema ya soporta ambas operaciones).

## Verificación
- `npm run typecheck` ✅ (0 errores)
- `npm run lint` ✅ (0 errores/warnings)
- `npm run build` ✅ (10 rutas; nueva `ƒ /api/threads/[id]`). Aviso preexistente
  de edge runtime heredado; no bloquea.
- **Capturas mobile + desktop / flujo end-to-end**: pendiente de ejecución manual
  por Luis. Este worktree no tiene `.env.local` (Supabase/LLM) ni la migración
  `0002_rag.sql` aplicada, así que el flujo autenticado (registrar→subir PDF→ver
  "Listo"→preguntar) no se puede capturar desde aquí. La UI compila y el flujo
  está implementado contra los contratos de API documentados por AG01/AG02.

## Pendientes que hereda el siguiente agente / Luis
- **Luis**: con `.env.local` + migración `0002` aplicada + Edge Function `embed`
  desplegada, ejecutar el flujo y adjuntar capturas mobile (≤360px) y desktop al PR.
- Posible mejora futura: estado de subida persistente por documento (hoy el toast
  es efímero por sesión del input); el panel de la sidebar ya refleja el status real.

## Notas de auditoría
(Lo completa el auditor.)
