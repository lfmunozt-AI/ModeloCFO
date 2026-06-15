# Control de cambios — AG04B · UX / Frontend (sesión 2)

| Campo | Valor |
|---|---|
| Agente | AG04B — UX / Frontend |
| Rama | agent/04b-ux2 |
| Worktree | wt-modelocfo-ag04b |
| Fecha | 2026-06-15 |
| Estado | PR draft |

## Alcance ejecutado
Tres bloques de UI para la fase de evaluación del modelo *The Consigliere*
(plataforma **Monoend by andgcore**): (1) **WelcomePanel** de primera sesión con
los textos contractuales y tres starters; (2) **pulgares de validación RLHF**
(👍/👎 + comentario inline) bajo cada respuesta del asistente, con actualización
optimista; (3) ruta **`POST /api/feedback`** que valida y registra la señal en
`feedback_signals` (tabla de AG02C), con 503 claro si aún no existe. Tailwind
puro, sin dependencias nuevas. No se tocó `lib/llm.ts`, `lib/rag.ts`, migraciones,
Edge Function, `app/api/chat/route.ts` ni `app/api/documents/route.ts`.

## Archivos clave creados/modificados
- `components/WelcomePanel.tsx` (nuevo) — panel de primera sesión: título +
  4 párrafos (texto sin alterar) + 3 botones starter que invocan `onStart(text)`
  (mismo flujo que escribir en MessageInput). Array de starters local con
  `TODO(AG08)` para unificar con `lib/starters.ts` cuando exista.
- `components/Message.tsx` — `"use client"`; bajo cada respuesta del asistente con
  id persistido, sub-componente `FeedbackControls`: 👍/👎 discretos, optimistic
  update sin spinner, toggle (re-clic deselecciona), uno solo activo; al pulsar 👎
  aparece inline un textarea (placeholder "¿Qué falló en esta respuesta?", botón
  "Enviar", máx 500 chars validados en cliente). Markdown del asistente intacto.
- `components/ChatWindow.tsx` — monta el WelcomePanel encima del MessageInput solo
  en primera sesión (`total=0`) y lo oculta al crearse el hilo; detecta primera
  sesión vía `GET /api/threads` (`total`); tras cerrar el stream **hidrata los ids
  reales** de los mensajes (`GET /api/threads/[id]`) para habilitar el feedback;
  pasa `id`/`threadId`/`isFirstSession` a cada `Message`.
- `app/api/feedback/route.ts` (nuevo) — `POST`: `getUser()` obligatorio (nunca
  user_id del cliente); valida message_id/thread_id (uuid), rating
  (positive|negative), comment (≤500), is_first_session (bool, default false);
  verifica propiedad del mensaje (join `messages→threads` por user_id); inserta en
  `feedback_signals`; **503** si la tabla no existe; **201 `{ok:true}`** al éxito.
- `app/api/threads/[id]/route.ts` — añade `GET` (mensajes del hilo: id, role,
  content) con check de propiedad + 404, para la hidratación de ids del cliente.
- `app/api/threads/route.ts` — `GET` ahora devuelve `{ threads, total }` (count
  exacto); `total` alimenta la detección de primera sesión.
- `app/chat/[threadId]/page.tsx` — selecciona `id` de los mensajes y lo propaga a
  `ChatWindow` (los mensajes ya persistidos pueden recibir feedback al instante).
- `lib/types.ts` — `ChatMessage.id?` (opcional) + tipo `FeedbackRating`.
- `tests/api/feedback.test.ts` (nuevo, 8 casos) y ampliación de
  `tests/api/threads-id.test.ts` (3 casos de `GET`). Total suite: 47 tests.

## Decisiones técnicas tomadas
1. **IDs de mensajes para el feedback sin tocar `/api/chat`.** El feedback exige
   un `message_id` real. Los mensajes ya persistidos llegan con id desde la página
   del hilo; el mensaje recién generado por streaming **no** tiene id en cliente.
   En vez de modificar `/api/chat` (restringido), tras cerrar el stream el cliente
   hace `GET /api/threads/[id]` y reemplaza el estado optimista por el persistido
   (con ids). Es seguro porque `onComplete` se **espera** antes de cerrar el stream
   (decisión AG01), así que al recibir `done` la respuesta ya está en la BD. Se
   añadió por eso un `GET` a `/api/threads/[id]` (ruta no restringida).
2. **`is_first_session` = primera respuesta del hilo.** El criterio literal dice
   "index 0 del array"; como los pulgares solo viven en mensajes del asistente
   (nunca el índice 0, que es del usuario), se interpreta como *la primera
   respuesta del asistente del hilo* (`i === firstAssistantIndex`) — el primer
   intercambio. Es la lectura coherente con que la señal marque el arranque de la
   conversación.
3. **Optimistic, fire-and-forget.** El estado del pulgar cambia al instante; el
   POST va en segundo plano y no se revierte ante fallo de red (señal de bajo
   coste, no debe bloquear ni distraer). Deseleccionar es solo local (no hay POST
   de retracción en el contrato).
4. **WelcomePanel dentro de `ChatWindow`.** Es quien conoce el ciclo de vida del
   hilo (`X-Thread-Id`) y `handleSend`; así el panel desaparece exactamente al
   materializarse el hilo y los starters reusan el mismo flujo de envío. La
   detección de primera sesión se reevalúa al pedir "Nuevo hilo".
5. **`lib/starters.ts` NO se crea** (es de AG08). Array local en WelcomePanel con
   los valores exactos + `TODO` de unificación, como pide el prompt.
6. **503 vs 500 en feedback.** Si `feedback_signals` no existe (AG02C pendiente),
   se detecta por código (`42P01`/`PGRST205`) o mensaje y se responde 503 con
   texto claro, en vez de un 500 opaco.

## Contrato esperado de `feedback_signals` (para AG02C)
La ruta inserta: `user_id uuid`, `message_id uuid`, `thread_id uuid`,
`rating text ('positive'|'negative')`, `comment text null`, `is_first_session
bool`. Se asume RLS por `user_id` como en el resto de tablas.

## Verificación
- `npm run typecheck` ✅ (0 errores)
- `npm run lint` ✅ (0 errores/warnings)
- `npm run build` ✅ (10 rutas; nueva `ƒ /api/feedback`)
- `npm test` ✅ (47 tests, +11 sobre los 36 previos)
- **Capturas / flujo end-to-end**: pendiente de Luis (este worktree no tiene
  `.env.local` ni migraciones aplicadas; además `feedback_signals` la entrega
  AG02C). La UI compila y se codifica contra los contratos documentados.

## Pendientes que hereda el siguiente agente / Luis
- **AG02C**: crear la tabla `feedback_signals` (esquema arriba) + RLS. Hasta
  entonces el POST responde 503 (degradación controlada, sin romper la UI).
- **AG08**: crear `lib/starters.ts` y unificar el array de starters (hoy duplicado
  como fallback en `WelcomePanel`, marcado con TODO).
- **Luis**: aplicar migraciones + desplegar, validar el flujo (primera sesión →
  starter → respuesta → 👍/👎 → comentario) y adjuntar capturas mobile/desktop.

## Notas de auditoría
(Lo completa el auditor.)
