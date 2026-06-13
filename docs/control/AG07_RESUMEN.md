# Control de cambios — AG07 · QA / Testing

| Campo | Valor |
|---|---|
| Agente | AG07 — QA / Testing |
| Rama | agent/07-testing |
| Worktree | wt-modelocfo-ag07 |
| Fecha | 2026-06-13 |
| Estado | PR draft |

## Alcance ejecutado
Suite de tests automatizados (Vitest) sobre el backend del esqueleto + CI
endurecido (primer workflow de CI del repo). Cobertura: funciones puras de
`lib/` (chunking RAG, formateo de contexto, abstracción del LLM, derivación de
títulos) y los route handlers (`/api/chat`, `/api/threads/[id]`, `/api/documents`)
con Supabase, RAG y LLM mockeados. Sin tocar producción salvo extraer
`deriveTitle` a `lib/utils.ts` (refactor puro). 33 tests verdes, 1 `skip`
intencional (ver «Coordinación con AG03»).

## Archivos clave creados/modificados
- `vitest.config.ts` — runner Vitest, entorno `node`, alias `@/` espejo de
  `tsconfig`, `include: tests/**/*.test.ts`.
- `package.json` — dep dev `vitest`; scripts `test` (`vitest run`) y `test:watch`
  (`vitest`).
- `lib/utils.ts` — **nuevo**: `deriveTitle()` extraída desde
  `app/api/chat/route.ts` SIN cambiar comportamiento (mismas constantes 6
  palabras / 40 chars). Único cambio de producción permitido por el encargo.
- `app/api/chat/route.ts` — importa `deriveTitle` desde `@/lib/utils`; se elimina
  la definición local y sus constantes. Comportamiento idéntico.
- `tests/lib/rag.test.ts` — `chunkText` (vacío, < 1 chunk, solape, corte en
  frontera de palabra, progreso garantizado sin loop infinito) y `formatContext`
  (0 chunks → `""`; N chunks → delimitadores `<<< >>>` + advertencia
  anti-inyección).
- `tests/lib/llm.test.ts` — `streamChat` usa `LLM_BASE_URL`/`LLM_API_KEY`/
  `LLM_MODEL` del entorno (mock del SDK `openai`), formato SSE + `[DONE]`,
  `onComplete` con texto acumulado, y propagación de errores del proveedor (al
  crear la completion → rechaza; durante el stream → evento SSE de error).
- `tests/lib/utils.test.ts` — `deriveTitle`: 6 palabras, tope 40 chars, colapso
  de espacios múltiples, `trimEnd`, entrada vacía.
- `tests/api/chat.test.ts` — 401 sin sesión, 400 sin `message`, creación de hilo
  al vuelo con header `X-Thread-Id`, uso de `threadId` provisto, 404 si el hilo
  es ajeno.
- `tests/api/threads-id.test.ts` — 401 (PATCH/DELETE), 404 (PATCH/DELETE en hilo
  ajeno/inexistente, fix de AG03 ya en main), 200 al renombrar el propio.
- `tests/api/documents.test.ts` — POST: 401, 413 (>5 MB), 415 (tipo no
  soportado), y 201 con `.txt` válido.
- `tests/helpers/supabase-mock.ts` — mock encadenable del cliente Supabase
  (builder thenable con `.single()`/`await`, `auth.getUser`/`getSession`).
- `.github/workflows/ci.yml` — **nuevo**: CI endurecido (detalle abajo).

## Decisiones técnicas tomadas
- **Vitest** (no Jest): integración nativa con el toolchain de Vite/esbuild,
  resuelve TS y el alias `@/` sin transpilación extra ni `ts-jest`. Es la única
  librería nueva; justificada como framework de pruebas del entregable QA.
- **Entorno `node`** (no `jsdom`): todo lo testeado es backend; los handlers se
  invocan directamente con `Request`/`FormData` nativos (undici de Node 20).
- **Mock por módulo** (`vi.mock`) de `@/lib/supabase/server`, `@/lib/rag` y
  `@/lib/llm`: cada capa se prueba en aislamiento. El test del LLM mockea el SDK
  `openai` y usa `vi.resetModules()` para resetear el cliente cacheado y poder
  afirmar los args del constructor por test.
- **`deriveTitle` extraída**, no duplicada: testear la copia habría permitido que
  divergiera del original. Mover la función (refactor puro) mantiene una sola
  fuente de verdad.

## CI endurecido (`.github/workflows/ci.yml`)
- `permissions: contents: read` a nivel de workflow (mínimo privilegio).
- Disparador `pull_request` a `main`. **Jamás** `pull_request_target`.
- Acciones de terceros fijadas por **SHA completo** (no por tag):
  - `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` # v4.2.2
  - `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` # v4.4.0
- `npm ci` (nunca `npm install`): instalación reproducible desde el lockfile.
- Un job `verify` corre **lint → typecheck → build → test** en cada PR a `main`.
- Cero secretos en el workflow.

## Coordinación con AG03 (resuelto en el rebase)
El fix del 404 lo entregó **AG03** (commit `4a519be`, ya en `main`): PATCH usa
`.maybeSingle()` y DELETE comprueba las filas afectadas; ambos responden 404 (no
500/204) en hilo ajeno/inexistente. Tras `git rebase origin/main`:
- Se **quitó el `.skip`**: el test de 404 ahora corre de verdad (PATCH y DELETE)
  + un test de 200 al renombrar el hilo propio.
- **Conflicto resuelto** en `app/api/chat/route.ts`: se conserva el rate limiting
  de AG03 y se mantiene mi refactor (`deriveTitle` importado de `@/lib/utils`, sin
  copia local).
- El mock de Supabase se amplió con `.maybeSingle()` y filtros encadenables
  (`.gte()`, etc.) que introdujeron el rate limiting de chat/documents.

## Verificación (post-rebase sobre AG03)
- `npm test` ✅ — 36 passed (6 archivos), 0 skipped.
- `npm run typecheck` ✅ (0 errores).
- `npm run lint` ✅ (0 errores/warnings).
- `npm run build` ✅ (9 rutas; build reproducible sin variables de entorno).

## Cómo correr los tests en local
```bash
npm ci             # instala dependencias desde el lockfile (incluye vitest)
npm test           # corre toda la suite una vez (vitest run)
npm run test:watch # modo watch durante el desarrollo

# Subconjuntos:
npx vitest run tests/lib    # solo unit tests (lib/)
npx vitest run tests/api    # solo route handlers
```
Los tests no necesitan Supabase, red ni variables de entorno: Supabase, el RAG y
el LLM están mockeados. El mismo `npm test` corre en CI como último paso del job.

## Pendientes que hereda el siguiente agente / Luis
- `npm audit`: vulnerabilidades transitivas heredadas (toolchain de dev /
  `unpdf`); no afectan runtime de producción. Revisar en mantenimiento.
- Opcional: tests del rate limiting (429) de chat/documents introducido por AG03;
  queda fuera del alcance original de AG07 (ruta propiedad de AG03).

## Notas de auditoría
(Lo completa el auditor.)
