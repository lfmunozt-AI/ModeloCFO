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
