# CLAUDE.md — ModeloCFO

Banco de pruebas para un modelo CFO fine-tuneado. Chat web multitenant
minimalista, 5 usuarios máximo.

## Stack (fijo)

Next.js 15 (App Router) · TypeScript · Tailwind v4 · Supabase
(auth/db/storage/edge) · SDK `openai` apuntando a `LLM_BASE_URL` · Vercel.

No introducir otras librerías sin justificarlo en el PR.

## Estructura

```
app/
  page.tsx                  → redirige a /chat
  login/page.tsx            → auth email+contraseña (Supabase)
  chat/
    layout.tsx              → shell: Sidebar + contenido
    page.tsx                → estado vacío (sin hilo)
    [threadId]/page.tsx     → mensajes del hilo + ChatWindow
  api/
    chat/route.ts           → POST {threadId, message} → stream SSE del LLM (edge)
    threads/route.ts        → GET lista / POST crea hilos
    documents/route.ts      → GET lista / POST ingesta (stub → AG02)
lib/
  llm.ts                    → streamChat(): cliente LLM agnóstico de proveedor
  rag.ts                    → retrieveContext(): stub (AG02 lo implementa)
  types.ts                  → tipos del dominio
  supabase/client.ts        → cliente browser (anon)
  supabase/server.ts        → cliente servidor (cookies/RLS) + admin (service role)
components/
  Sidebar.tsx               → lista de hilos + nuevo hilo + logout
  ChatWindow.tsx            → estado de mensajes + consumo del stream SSE
  MessageInput.tsx          → caja de entrada
  Message.tsx               → burbuja de mensaje
middleware.ts               → refresco de sesión + protección de /chat
supabase/migrations/        → esquema (threads, messages, documents) + RLS
```

## La abstracción del LLM (entregable clave)

Todo el tráfico al LLM pasa por `lib/llm.ts`. El proveedor se decide SOLO por
variables de entorno (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`). Nada en el
código asume OpenAI: el SDK `openai` se usa únicamente como cliente del
protocolo HTTP compatible. Cambiar de `gpt-4o-mini` a un endpoint vLLM en Modal
= cambiar esas tres variables. Ver `docs/MODAL_DEPLOY.md`.

`streamChat(messages, systemPrompt, { onComplete })` devuelve un
`ReadableStream` ya formateado como SSE (`data: {"token": "..."}\n\n`, cerrado
con `data: [DONE]`). El callback `onComplete` recibe el texto completo para
persistir la respuesta del asistente.

## Flujo del chat

`POST /api/chat {threadId, message}` → valida sesión → verifica propiedad del
hilo → persiste mensaje del usuario → recupera últimos 10 mensajes → añade
contexto RAG (`lib/rag.ts`, stub) → construye `[system + RAG + historial]` →
`streamChat()` → al cerrar el stream persiste la respuesta del asistente.

## Reglas del proyecto

1. `main` protegida: solo se entra por Pull Request en DRAFT. No push directo.
2. Commits convencionales: `feat:`, `fix:`, `chore:`, `docs:`, `test:`.
3. Nunca hardcodear secretos. Todo por entorno; actualizar `.env.example`.
4. RLS activo en TODAS las tablas (multitenant por `user_id`).
5. Minimalismo: cero estadísticas, cero ICA/IDF, cero dashboards. Solo login,
   sidebar de hilos y chat.
6. Idioma del código: inglés · UI por defecto: español.

## Comandos

```bash
npm run dev        # desarrollo
npm run build      # build de producción (criterio de aceptación)
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

## Propiedad por agente

- **AG01 (arquitecto):** esqueleto completo, `lib/llm.ts`, rutas, UI base.
- **AG02 (datos/RAG):** `lib/rag.ts` real, ingesta en `api/documents`,
  embeddings/pgvector, ampliación de `supabase/migrations`.
