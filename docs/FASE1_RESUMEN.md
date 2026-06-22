# ModeloCFO — Resumen ejecutivo de la Fase 1

> Documento consolidado de cierre de la Fase 1 (AG05, documentación).
> Unifica los seis resúmenes de control de `docs/control/`. Para el detalle
> completo de cada agente, ver su `AGxx_RESUMEN.md`.
>
> **Estado de la fase:** todas las ramas mergeadas en `main` por PR. Producto
> listo para los 5 testers una vez Luis aplique migraciones, despliegue la Edge
> Function y configure las variables de entorno (ver «Pendientes operativos»).

---

## 1. Qué se construyó

ModeloCFO es un **chat web multitenant minimalista** (5 usuarios máximo) que
sirve de banco de pruebas para un modelo CFO fine-tuneado (Mistral 7B + LoRA).
La Fase 1 entrega el producto completo end-to-end: autenticación, chat con
streaming, RAG sobre documentos del usuario, memoria conversacional, aislamiento
multitenant verificado, suite de tests + CI, y la documentación operativa.

La pieza estratégica es la **abstracción del LLM**: todo el tráfico al modelo
pasa por `lib/llm.ts` y el proveedor se decide solo por tres variables de
entorno. Pasar de `gpt-4o-mini` al modelo propio en Modal no toca código (ver
`docs/SWITCH_MODEL.md`).

---

## 2. Arquitectura

```
Navegador (Next.js App Router, RSC + cliente)
   │  email+contraseña (Supabase Auth) · cookies de sesión vía middleware
   ▼
Route handlers (app/api/*)            ──► Supabase (Postgres + RLS + Auth)
   ├─ /api/chat        (edge, SSE)         threads · messages · documents
   ├─ /api/threads     (lista/crea)        document_chunks · memory_chunks
   ├─ /api/threads/[id](renombra/borra)    + funciones RPC match_chunks /
   └─ /api/documents   (ingesta RAG)         match_context (SECURITY INVOKER)
   │
   ├─ lib/llm.ts   ──► LLM_BASE_URL (OpenAI-compatible: gpt-4o-mini → vLLM/Modal)
   └─ lib/rag.ts   ──► Edge Function `embed` (gte-small, 384-dim) ──► pgvector
```

**Flujo del chat:** `POST /api/chat {threadId?, message}` → valida sesión →
(rate limit) → crea el hilo si no llega `threadId` → persiste el mensaje del
usuario → recupera contexto (RAG: documentos + memoria vía `match_context`) →
construye `[system + contexto + últimos 10 mensajes]` → `streamChat()` devuelve
SSE token a token → al cerrar el stream persiste la respuesta del asistente y
embebe el turno como recuerdo.

**Pilares transversales:**

- **Multitenancy por `user_id` con RLS en TODAS las tablas.** Ninguna ruta
  acepta `user_id` del cliente; la identidad sale siempre de
  `supabase.auth.getUser()`. Doble defensa en las RPC: `SECURITY INVOKER`
  (heredan la RLS del llamante) **y** filtro explícito por `auth.uid()`.
- **LLM agnóstico de proveedor** (`lib/llm.ts`): SDK `openai` usado solo como
  cliente del protocolo HTTP compatible; el proveedor es configuración.
- **Embeddings sin coste ni secretos externos**: `gte-small` (384-dim) dentro
  de una Edge Function de Supabase que verifica el JWT del llamante.
- **Streaming SSE nativo** en runtime edge para latencia mínima.

---

## 3. Agentes y entregas

| Agente | Rol | Entregas principales | Archivos clave | Estado |
|---|---|---|---|---|
| **AG01** | Arquitecto | Esqueleto Next.js 15, abstracción LLM con SSE, rutas chat/threads/documents, UI base (login/sidebar/chat), migración inicial + RLS, doc de despliegue Modal. Hotfix UX: chat activo sin crear hilo a mano + creación perezosa de hilo (`X-Thread-Id`). | `lib/llm.ts`, `app/api/chat/route.ts`, `middleware.ts`, `0001_init.sql`, `docs/MODAL_DEPLOY.md` | Mergeado |
| **AG02** | Datos / RAG | RAG real: pgvector + `document_chunks` (HNSW coseno), Edge Function `embed`, `lib/rag.ts` (parseo PDF/TXT/MD, chunking, embeddings por lotes, ingesta con estado), ingesta real en `/api/documents`, seed sintético, `match_chunks` SECURITY INVOKER. | `0002_rag.sql`, `supabase/functions/embed/index.ts`, `lib/rag.ts`, `scripts/seed.ts` | Mergeado |
| **AG02B** | Datos / Memoria | Memoria conversacional: tabla `memory_chunks` + `match_context` (UNION docs+memoria, top-K global), `ingestMemoryExchange()`, system prompt consciente de la memoria. Sidebar sin panel «Documentos» (memoria invisible). | `0003_memory.sql`, `lib/rag.ts`, `app/api/chat/route.ts` | Mergeado |
| **AG03** | Seguridad | Auditoría cross-tenant (`scripts/security-check.ts`, 12 vectores), fix 404 en `/api/threads/[id]`, rate limiting sobre Postgres en chat/documents, cabeceras de seguridad globales, checklist de higiene de secretos/RLS, propuesta de CSP. | `scripts/security-check.ts`, `next.config.ts`, `app/api/threads/[id]/route.ts` | Mergeado |
| **AG04** | UX / Frontend | Subida de documentos desde el chat (clip 📎 + toast), gestión de hilos (renombrar/eliminar), render Markdown del asistente, shell responsive con drawer móvil, indicador «escribiendo…», estados vacíos guía. | `components/ChatShell.tsx`, `components/MessageInput.tsx`, `components/Sidebar.tsx`, `components/Message.tsx` | Mergeado |
| **AG07** | QA / Testing | Suite Vitest (36 tests: funciones puras de `lib/` + route handlers con Supabase/RAG/LLM mockeados), refactor puro de `deriveTitle` a `lib/utils.ts`, primer workflow de CI endurecido (acciones fijadas por SHA, `npm ci`, mínimo privilegio). | `vitest.config.ts`, `tests/**`, `lib/utils.ts`, `.github/workflows/ci.yml` | Mergeado |

> **AG05 (este documento):** cierre de documentación de fase —
> `FASE1_RESUMEN.md`, `README.md`, `RUNBOOK.md`, `SWITCH_MODEL.md` y la
> plantilla de PR.

---

## 4. Decisiones técnicas clave

1. **El LLM es configuración, no código** (AG01). `lib/llm.ts` usa el SDK
   `openai` como cliente de un protocolo HTTP compatible. `streamChat()`
   devuelve un `ReadableStream` ya formateado como SSE (`data: {"token":…}` →
   `data: [DONE]`). El callback `onComplete` se **espera (await)** antes de
   cerrar el stream para garantizar la persistencia de la respuesta.

2. **Creación perezosa de hilos** (AG01, hotfix). El input está activo al
   entrar a `/chat`; el hilo se materializa con el primer mensaje. El servidor
   devuelve el id en la cabecera `X-Thread-Id` y el cliente adopta la URL con
   `window.history.replaceState` (no `router.replace`) para **no desmontar el
   componente ni abortar el stream** en curso. Trade-off conocido: el hilo
   recién creado no queda resaltado como activo hasta navegar/recargar.

3. **Embeddings en el edge con `gte-small`** (AG02). 384-dim, sin coste por
   token ni secretos nuevos; el vector se calcula dentro de Supabase. La Edge
   Function `embed` verifica el JWT para no ser un oráculo abierto.

4. **`unpdf` por import dinámico** (AG02). Edge-compatible y cargado solo dentro
   de `ingestDocument`, de modo que NO entra en el bundle edge de `/api/chat`
   (la ruta pesa 136 B). `react-markdown` (AG04) y `vitest` (AG07) son las otras
   dependencias nuevas, cada una justificada en su PR.

5. **Recuperación unificada en SQL: `match_context`** (AG02B). UNION ALL de
   `document_chunks` + `memory_chunks` con un único `ORDER BY similarity LIMIT
   k` → top-K global real en una sola llamada, en vez de dos RPC reordenadas en
   cliente. Mismo modelo de aislamiento que `match_chunks` (se conserva,
   aunque el chat ya no la use).

6. **Defensa anti-inyección de prompt** (AG02). `formatContext()` delimita el
   contenido de documentos/recuerdos entre `<<< >>>` con instrucción explícita
   de tratarlo como DATO no confiable; nunca se concatena como instrucción.

7. **Aislamiento como propiedad de la base de datos** (AG03). RLS por `user_id`
   en todas las tablas (0001/0002/0003) + RPC `SECURITY INVOKER` con filtro
   `auth.uid()`. `scripts/security-check.ts` prueba 12 vectores cross-tenant
   (REST anon, RPC y route handlers) y sale con código 1 ante cualquier fuga.

8. **404 sin filtrar existencia** (AG03). PATCH/DELETE de `/api/threads/[id]`
   filtran por `id` **y** `user_id`; con 0 filas no se distingue «no existe» de
   «es de otro usuario» → ambos 404. No se revela la existencia de hilos ajenos.

9. **Rate limiting contado en Postgres** (AG03). El runtime edge no tiene estado
   entre invocaciones: se cuenta sobre las propias filas (`messages`/`documents`
   con `head:true` + `count:'exact'`) antes de crear hilo/persistir/inferir.
   Configurable: `RATE_LIMIT_PER_HOUR` (40), `RATE_LIMIT_UPLOADS_DAY` (10).

10. **CI endurecido** (AG07). `pull_request` a `main` (nunca
    `pull_request_target`), acciones de terceros fijadas por **SHA completo**,
    `npm ci`, `permissions: contents: read`, y un job que corre
    lint → typecheck → build → test. Cero secretos en el workflow.

---

## 5. Estado del backlog

**Verde en todas las ramas:** `npm run build` ✅ · `npm run typecheck` ✅ ·
`npm run lint` ✅ · `npm test` ✅ (36 tests). Sin dependencias añadidas en esta
fase de cierre.

### Pendientes operativos (responsabilidad de Luis)

Por protocolo del proyecto, aplicar migraciones y validar contra el proyecto
vivo es responsabilidad de Luis. Antes de abrir a los testers:

- [ ] Aplicar las migraciones `0001_init.sql`, `0002_rag.sql`, `0003_memory.sql`
      en el proyecto Supabase (`supabase db push` o el SQL Editor).
- [ ] Desplegar la Edge Function: `supabase functions deploy embed`.
- [ ] Configurar las variables de entorno en Vercel (Supabase + LLM + rate
      limits) — ver `.env.example`.
- [ ] Ejecutar `npx tsx scripts/security-check.ts` contra el proyecto real (con
      `npm run dev` activo para los vectores 9–11) y adjuntar la salida al PR.
- [ ] (Opcional) `npm run seed` en local para datos sintéticos de prueba.
- [ ] (Opcional) Ejecutar `supabase/tests/verify_isolation.sql` en el SQL Editor.
- [ ] Validar el flujo cross-thread de memoria (criterio de aceptación de AG02B:
      «número de socio 8841» mencionado en hilo A, preguntado en hilo B).
- [ ] (AG04) Adjuntar capturas mobile (≤360px) y desktop del flujo end-to-end.

### Deuda técnica conocida (no bloqueante)

- `npm audit`: vulnerabilidades **transitivas** vía `unpdf`/`pdfjs` y toolchain
  de dev; no afectan al runtime de producción. Revisar en mantenimiento.
- Aviso preexistente de `@supabase/ssr` (`process.version` en edge): no bloquea
  el build.
- `createSupabaseAdminClient` (service role) existe en `lib/supabase/server.ts`
  **sin call-sites** en la app. Candidata a retirar en una limpieza futura para
  que «service role solo en `scripts/`» sea literal.
- Poda/expiración de `memory_chunks` antiguos para acotar el crecimiento.

---

## 6. Pendientes para la Fase 2

1. **Swap del modelo: `gpt-4o-mini` → modelo CFO propio en Modal.** Pipeline
   LoRA → merge (Unsloth) → cuantización AWQ → vLLM en Modal (L4,
   scale-to-zero) → apuntar `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`. No toca
   código. Ver `docs/MODAL_DEPLOY.md` y `docs/SWITCH_MODEL.md`.

2. **CSP (Content-Security-Policy).** Propuesta documentada por AG03 (en
   `next.config.ts` y `AG03_RESUMEN.md`) pero **no aplicada** para no arriesgar
   la hidratación / el streaming SSE antes de los testers. Requiere nonces por
   request inyectados vía middleware y pruebas de que no rompen el chat.

3. **Tests end-to-end con Playwright.** La suite actual cubre `lib/` y los route
   handlers con mocks; falta cobertura de navegador del flujo completo
   (login → subir documento → ver «Listo» → preguntar → respuesta) y del
   responsive móvil.

4. **Mantenimiento.** Resolver `npm audit`, decidir sobre la factory admin no
   usada, y diseñar poda de `memory_chunks`.
