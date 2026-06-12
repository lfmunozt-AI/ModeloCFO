# Control de cambios — AG02 · Datos / RAG

| Campo | Valor |
|---|---|
| Agente | AG02 — Datos / RAG |
| Rama | agent/02-datos |
| Worktree | wt-modelocfo-ag02 |
| Fecha | 2026-06-12 |
| Estado | PR draft |

## Alcance ejecutado
RAG real de ModeloCFO sobre el esqueleto de AG01 (parte de la migración 0001, no
la recrea). pgvector + `document_chunks` con RLS por `user_id` e índice HNSW
coseno; función `match_chunks` SECURITY INVOKER que filtra por `auth.uid()`. Edge
Function `embed` (gte-small, 384-dim) con verificación de JWT. `lib/rag.ts` real
(parseo PDF/TXT/MD, chunking con solape, embeddings por lotes, ingesta con estado)
y recuperación delimitando el contenido como dato no confiable. Ingesta real en
`/api/documents` POST y seed sintético.

## Archivos clave creados/modificados
- `supabase/migrations/0002_rag.sql` — extensión vector; `document_chunks`
  (+RLS +HNSW vector_cosine_ops); `ALTER documents ADD status` (processing|ready|
  error); `match_chunks(vector(384), int)` SECURITY INVOKER + grants.
- `supabase/functions/embed/index.ts` — Edge Function: `{texts}` → vectores 384-dim
  con `Supabase.ai.Session('gte-small')`; valida el JWT del llamante antes de
  generar nada.
- `lib/rag.ts` — `ingestDocument()` (extrae texto, trocea ~500 tokens/solape 50,
  embebe por lotes, inserta chunks, fija status), `retrieveContext()` (embebe la
  consulta → `match_chunks` → top 5 con nombre del doc; nunca lanza, firma estable
  intacta) y `formatContext()` endurecido contra inyección de prompt.
- `app/api/documents/route.ts` — POST real (multipart, valida sesión, 5 MB,
  pdf/txt/md, lanza la ingesta); GET extendido con `status`.
- `scripts/seed.ts` — 2 usuarios sintéticos (tester1/tester2@test.local) con 1 hilo
  y 1 documento cada uno; service role solo en local; idempotente.
- `supabase/tests/verify_isolation.sql` — prueba de aislamiento multitenant.
- `package.json` — `unpdf` (parseo PDF edge-friendly) y `tsx` (runner del seed) +
  script `seed`. `tsconfig.json`/`eslint.config.mjs` excluyen `supabase/functions`
  (runtime Deno).

## Decisiones técnicas tomadas
1. **`gte-small` en el edge** en vez de un proveedor externo de embeddings: 384-dim,
   sin coste por token, sin secretos nuevos. El vector se calcula dentro de
   Supabase. La Edge Function verifica JWT para no ser un oráculo abierto.
2. **Seguridad de prompt en `formatContext`**: el contenido de documentos va entre
   `<<<` y `>>>` precedido de una instrucción explícita de tratarlo como DATO y de
   ignorar cualquier orden que contenga. Nunca se concatena como instrucción.
3. **Doble defensa de aislamiento**: `match_chunks` es SECURITY INVOKER (hereda la
   RLS del llamante) y además filtra por `auth.uid()` explícitamente. Imposible
   recuperar chunks de otro usuario aunque el vector de consulta coincida.
4. **`unpdf` (no `pdf-parse`)**: edge-compatible, sin binarios nativos, sin el bug
   del fichero de test de pdf-parse. Cargado por **import dinámico** dentro de
   `ingestDocument`, de modo que NO entra en el bundle edge de `/api/chat`
   (verificado: la ruta pesa 136 B en el build).
5. **Ingesta síncrona en la request**: para 5 usuarios y ≤5 MB el documento pasa de
   `processing` a `ready`/`error` dentro del POST. El estado queda como columna
   para soportar ingesta asíncrona en el futuro sin cambiar el esquema.
6. **Chunking por caracteres** (~4 chars/token → 2000 chars, solape 200) cortando en
   frontera de espacio. Heurística simple y suficiente; gte-small trunca a 512
   tokens, vamos por debajo.

## Verificación
- `npm run typecheck` ✅ (0 errores)
- `npm run lint` ✅ (0 errores/warnings)
- `npm run build` ✅ (9 rutas). Aviso preexistente de `@supabase/ssr`
  (`process.version` en edge) heredado de AG01; no bloquea el build.
- Aislamiento multitenant: `supabase/tests/verify_isolation.sql` — como usuario A,
  `match_chunks` devuelve solo `doc-A.md`; como usuario B, solo `doc-B.md`, con el
  MISMO vector de consulta. Pendiente de ejecutar en el proyecto una vez aplicada
  la migración (ver «Pendientes»).

## Cómo probar end-to-end (manual)
1. Aplicar `0002_rag.sql` en Supabase y desplegar la función: `supabase functions
   deploy embed`.
2. `npm run seed` (con `SUPABASE_SERVICE_ROLE_KEY` en el entorno local).
3. Subir un PDF: `POST /api/documents` (multipart, campo `file`) → respuesta
   `201 {status:'ready', chunks:N}`; aparece N filas en `document_chunks` con
   `embedding` no nulo.
4. Chatear: `POST /api/chat` con una pregunta sobre el documento → el system prompt
   recibe el contexto delimitado entre `<<<…>>>` (ver `formatContext`).
5. Aislamiento: ejecutar `supabase/tests/verify_isolation.sql` en el SQL Editor.

## Pendientes que hereda el siguiente agente / Luis
- **Luis**: aplicar `0002_rag.sql`, desplegar la Edge Function `embed`, y ejecutar
  `verify_isolation.sql` para adjuntar la salida real al PR. (Sigue el protocolo de
  AG01: la aplicación de migraciones en producción es responsabilidad de Luis.)
- UI de subida de documentos (no es alcance de AG02: restricción «no tocar UI»).
- `npm audit`: 6 vulnerabilidades transitivas vía `unpdf`/`pdfjs`/toolchain de dev;
  no afectan a runtime de producción. Revisar en una pasada de mantenimiento.

## Notas de auditoría
(Lo completa el auditor.)
