# Control de cambios — AG01 · Arquitecto

| Campo | Valor |
|---|---|
| Agente | AG01 — Arquitecto |
| Rama | agent/01-arquitecto |
| Worktree | wt-modelocfo-ag01 |
| Fecha | 2026-06-12 |
| Estado | Auditado — fixes aplicados, pendiente PR + merge |

## Alcance ejecutado
Esqueleto completo de ModeloCFO: Next.js 15 (App Router, TS, Tailwind), abstracción
LLM agnóstica de proveedor con streaming SSE, API de chat/threads/documents con
validación de sesión server-side, UI base (login, sidebar, chat), migración inicial
de Supabase con RLS multitenant, y documentación de despliegue del modelo en Modal.
5 commits atómicos convencionales.

## Archivos clave creados/modificados
- `lib/llm.ts` — streamChat() agnóstico vía LLM_BASE_URL/LLM_API_KEY/LLM_MODEL; persiste respuesta antes de cerrar el stream (onComplete awaited).
- `app/api/chat/route.ts` — runtime edge, SSE, valida sesión y propiedad del hilo, no acepta user_id del cliente.
- `app/api/threads/route.ts`, `app/api/documents/route.ts` — CRUD básico (documents POST = stub para AG02).
- `middleware.ts` — refresco de sesión @supabase/ssr + protección de /chat.
- `lib/supabase/{client,server}.ts`, `lib/rag.ts` (stub estable), `lib/types.ts`.
- `components/` — Sidebar, ChatWindow (SSE token a token), MessageInput, Message.
- `supabase/migrations/0001_init.sql` — threads/messages/documents + RLS en todas.
- `docs/MODAL_DEPLOY.md` — Unsloth merge → AWQ → vLLM Modal L4 scale-to-zero.
- `CLAUDE.md`, `.env.example`, `.claude/settings.json`, `.gitignore` blindado.

## Decisiones técnicas tomadas
1. Rama `agent/01-arquitecto` y worktree `wt-modelocfo-agXX` (el naming original colisionaba con sovereign-cfo). **Este es el estándar para todos los agentes a partir de ahora.**
2. Esquema simplificado: `documents` con `content` inline (sin storage_path/status aún); `messages` sin `user_id` — la tenencia se hereda del hilo vía política RLS por EXISTS. AG02 parte de la migración 0001, no del esquema del documento de planificación.
3. Runtime edge en /api/chat por latencia y streaming nativo.

## Verificación
- npm run build ✅ (9 rutas) · npm run typecheck ✅ (0 errores) · npm run lint ✅

## Pendientes que hereda el siguiente agente
- AG02: pgvector + document_chunks (migración 0002), Edge Function embed (gte-small), rag.ts real, ingesta en /api/documents POST, seed sintético, extender documents (storage_path/status) sin romper 0001.
- Luis: aplicar migración 0001 en Supabase, configurar env vars en Vercel, merge del PR.

## Notas de auditoría
Auditoría (Claude, 2026-06-12): arquitectura aprobada. 3 hallazgos corregidos:
(1) `.env.example` no llegó al repo porque `.gitignore` tenía `.env*` sin excepción
— añadida `!.env.example` y commiteado el archivo; (2) faltaba `.claude/settings.json`
con reglas deny (guardrails del modo bypass); (3) `.gitignore` sin blindaje de
datasets/pesos del modelo — añadidos *.jsonl, *.csv, *.gguf, *.safetensors,
datasets/, models/, lora_*/. Seguridad de API y RLS: sin hallazgos.

## Hotfix 1 — UX (2026-06-12)
| Campo | Valor |
|---|---|
| Rama | agent/01-hotfix-ux (desde origin/main, post-merge del esqueleto) |
| Worktree | wt-modelocfo-ag01-hotfix |
| Alcance | 2 tareas puntuales de UX. No se tocó nada fuera de ellas. |

### Tarea 1 — mensaje de registro
`app/login/page.tsx`: el mensaje largo de cuenta creada se reemplaza por la
línea exacta `"Cuenta creada, inicia sesión."` en el `setError` del branch signup.

### Tarea 2 — chat activo sin crear hilo a mano
El campo de mensaje está activo nada más entrar a `/chat`; el hilo se materializa
solo con el primer mensaje (no más hilos vacíos titulados "Nuevo hilo").
- `app/chat/page.tsx`: ahora renderiza `<ChatWindow threadId={null} />` (input
  activo desde el inicio) en lugar del estado vacío.
- `app/api/chat/route.ts`: `threadId` pasa a ser **opcional**. Si no llega, crea
  el hilo del usuario con título derivado del primer mensaje (~6 palabras, máx 40
  chars) y devuelve el id en la cabecera **`X-Thread-Id`** del stream SSE.
- `components/ChatWindow.tsx`: al recibir `X-Thread-Id` en la primera respuesta,
  adopta el hilo y sincroniza la URL a `/chat/<id>` **con `window.history.replaceState`**
  (no `router.replace`) para no desmontar el componente ni cortar el stream en
  curso — si se desmontase, la respuesta del asistente podría no llegar a
  persistirse en el servidor (`onComplete`). Avisa a la sidebar por evento.
- `components/Sidebar.tsx`: "Nuevo hilo" ahora solo navega a `/chat` (estado
  limpio) y emite `NEW_CHAT_EVENT`; ya no hace POST a `/api/threads` (cero filas
  vacías). Recarga la lista al recibir `THREADS_CHANGED_EVENT`.
- `lib/chat-events.ts` (nuevo): nombres de eventos de ventana para desacoplar
  ChatWindow ↔ Sidebar.

### Decisión de diseño (desviación justificada del sugerido)
Se usó `window.history.replaceState` en vez del `router.replace` sugerido en (c):
`router.replace` a `/chat/[id]` es un cambio de ruta de Next que **desmonta** el
subárbol de `/chat` y aborta el `fetch` en streaming, con riesgo de perder la
respuesta del asistente (la persistencia ocurre en `onComplete`, al cerrar el
stream). `replaceState` actualiza la URL sin navegación, manteniendo el stream
vivo en el mismo componente.

### Limitación menor conocida
Tras adoptar el hilo vía `replaceState`, `useParams()` no se actualiza hasta una
navegación real, por lo que el hilo recién creado aparece en la sidebar pero no
queda resaltado como activo hasta navegar a él o recargar. Trade-off aceptado a
favor de no cortar el stream.

### Verificación
- `npm run build` ✅ · `npm run typecheck` ✅ (0 errores) · `npm run lint` ✅
- Restricciones respetadas: no se tocó `lib/llm.ts`, `lib/rag.ts`, migraciones ni
  `middleware.ts`. El flujo de abrir un hilo existente y continuar queda intacto.
