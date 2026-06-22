# Control de cambios — AG03 · Seguridad

| Campo | Valor |
|---|---|
| Agente | AG03 — Ingeniero de seguridad |
| Rama | agent/03-security |
| Worktree | wt-modelocfo-ag03 |
| Fecha | 2026-06-13 |
| Estado | PR draft |

## Alcance ejecutado
Endurecimiento final pre-testers, sin añadir features de producto. (1) Script de
auditoría cross-tenant que, con dos usuarios de prueba, intenta acceder a los
datos de uno desde la sesión del otro por cada vía de la app (REST anon, RPC y
route handlers) y reporta vector por vector. (2) Fix del 404 en
`/api/threads/[id]` (PATCH y DELETE devolvían 500/204 cuando el hilo no existía o
era de otro usuario). (3) Rate limiting sobre Postgres (sin infraestructura
nueva) en `/api/chat` y `/api/documents`. (4) Cabeceras de seguridad globales en
`next.config.ts`. (5) Checklist de higiene de secretos/RLS firmado.

## Archivos clave creados/modificados
- `scripts/security-check.ts` — **entregable principal**: auditoría de aislamiento
  multitenant. Crea 2 usuarios con service role (solo local), siembra datos de A en
  TODAS las tablas y, actuando como B, prueba 12 vectores (ver reporte abajo).
- `app/api/threads/[id]/route.ts` — PATCH usa `maybeSingle()` + 404 explícito si no
  hay fila; DELETE usa `.select("id")` para detectar 0 filas afectadas → 404.
- `app/api/chat/route.ts` — rate limiting: cuenta mensajes `role='user'` del usuario
  en los últimos 60 min (join `messages→threads` por `user_id`) antes de crear hilo
  / persistir / llamar al LLM; 429 con `Retry-After` si supera `RATE_LIMIT_PER_HOUR`.
- `app/api/documents/route.ts` — rate limiting: cuenta documentos del usuario en las
  últimas 24 h; 429 si supera `RATE_LIMIT_UPLOADS_DAY` (antes de leer el multipart).
- `next.config.ts` — `headers()` aplica X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy y Permissions-Policy a todas las respuestas.
- `.env.example` — documenta `RATE_LIMIT_PER_HOUR` (40) y `RATE_LIMIT_UPLOADS_DAY` (10).

## Decisiones técnicas tomadas
1. **404 sin filtrar existencia.** PATCH/DELETE filtran por `id` **y** `user_id`; con
   0 filas no se distingue "no existe" de "es de otro usuario" → ambos 404. No se
   revela la existencia de hilos ajenos y deja de ser un 500 espurio.
2. **Rate limiting contado en Postgres, no en memoria.** El runtime edge de
   `/api/chat` no tiene estado entre invocaciones; cualquier contador en memoria sería
   inútil. Se cuenta sobre las propias filas (`messages`/`documents`) con `head:true`
   + `count:'exact'` (sin traer datos). El join `threads!inner` + filtro por `user_id`
   garantiza contar solo los hilos del usuario, además del scope RLS. Se comprueba
   **antes** de crear hilo/persistir/inferir, para que un usuario limitado no genere
   hilos vacíos ni gasto de LLM.
3. **CSP NO aplicada (propuesta documentada).** Una CSP estricta con el App Router de
   Next exige nonces por request inyectados vía middleware; mal configurada rompe la
   hidratación y/o el streaming SSE de `/api/chat`. Se deja la propuesta abajo en vez
   de arriesgar el chat justo antes de los testers (instrucción explícita del prompt).
4. **Cookie de sesión del atacante replicada con la propia librería.** Para ejercer
   los route handlers como B, el script firma a B con un `createServerClient` de
   @supabase/ssr sobre un jar en memoria y captura las cookies chunked exactas que el
   navegador habría guardado (robusto a versiones; nada de reconstruir el formato a
   mano).
5. **`createSupabaseAdminClient` se conserva.** Es la única aparición de
   `SUPABASE_SERVICE_ROLE_KEY` fuera de `scripts/` (ver checklist): factory server-only,
   **sin call-sites** en toda la app. No se elimina por respeto al alcance mínimo, pero
   se documenta como observación.

## Reporte de auditoría cross-tenant (vector por vector)
`scripts/security-check.ts` siembra datos del usuario **A** (con un marcador único) en
`threads`, `messages`, `documents`, `document_chunks` y `memory_chunks`, y luego, con
la sesión del usuario **B**, intenta:

| # | Vector (B contra datos de A) | Vía | Esperado |
|---|---|---|---|
| 1 | `SELECT threads` de A | REST (anon key, JWT de B) | 0 filas |
| 2 | `SELECT messages` de A | REST | 0 filas |
| 3 | `SELECT documents` de A | REST | 0 filas |
| 4 | `SELECT document_chunks` de A | REST | 0 filas |
| 5 | `SELECT memory_chunks` de A | REST | 0 filas |
| 6 | `RPC match_context` (mismo vector que el chunk de A) | REST | 0 filas con el marcador de A |
| 7 | `UPDATE thread` de A | REST | 0 filas afectadas |
| 8 | `DELETE thread` de A | REST | 0 filas afectadas |
| 9 | `PATCH /api/threads/[idA]` | route (cookies de B) | 404, A intacto |
| 10 | `DELETE /api/threads/[idA]` | route (cookies de B) | 404, A intacto |
| 11 | `PATCH /api/threads/[inexistente]` | route (cookies de B) | 404 (no 500) |
| 12 | Integridad: el hilo de A sobrevive a 7–10 | service role | existe, título intacto |

**Garantía esperada: 0 fugas / 0 escrituras cruzadas / 0 éxitos.** El aislamiento se
apoya en RLS por `user_id` en todas las tablas (0001/0002/0003) y en `match_context`
SECURITY INVOKER con filtro `auth.uid()` en ambas ramas del UNION. Los vectores 1–8 y
12 no requieren servidor (prueban la garantía a nivel de base de datos, la
autoritativa); 9–11 ejercen además los route handlers y se marcan `SKIPPED` si el
servidor de desarrollo no está accesible (en ese caso, 7–8 ya prueban el bloqueo de
escritura cruzada por RLS).

### Cómo ejecutar la auditoría
```bash
export NEXT_PUBLIC_SUPABASE_URL=...        # proyecto con 0001/0002/0003 aplicadas
export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...       # SOLO local; nunca se commitea
# (opcional) export SECURITY_CHECK_BASE_URL=http://localhost:3000
npm run dev                                # en otra terminal, para los vectores 9–11
npx tsx scripts/security-check.ts          # → tabla de resultados; exit 1 si hay fuga
```
Pendiente de ejecución contra el proyecto real por Luis (mismo protocolo que AG01/AG02:
la aplicación de migraciones y la validación en el proyecto vivo es suya). El script
sale con código 1 ante cualquier FUGA, apto para CI.

## Checklist de higiene (firmado: AG03, 2026-06-13)
- [x] **`SUPABASE_SERVICE_ROLE_KEY` no aparece en código de app servido al cliente.**
  Apariciones en el repo: `.env.example` (comentario, sin valor), `scripts/seed.ts`,
  `scripts/security-check.ts` (ambos en `scripts/`, solo local) y
  `lib/supabase/server.ts` → `createSupabaseAdminClient`. Esta última es una factory
  **server-only sin ningún call-site** en toda la app (verificado por grep: 0 usos en
  `app/`, `components/`, `middleware.ts`). No hay ruta de exposición al cliente; el
  **valor** del secreto no está hardcodeado en ningún sitio. Observación: podría
  retirarse en una limpieza futura para que la frase "solo en `scripts/`" sea literal.
- [x] **`.env*` blindado.** `.gitignore`: `.env*` con excepción `!.env.example`. El
  único `.env*` versionado es `.env.example` (verificado con `git ls-files`).
- [x] **Ningún secreto hardcodeado.** No hay JWT/keys literales en el código (el único
  match `eyJ…` es un hash de integridad en `package-lock.json`).
- [x] **Ninguna ruta acepta `user_id` del cliente.** Todas las rutas derivan la
  identidad de `supabase.auth.getUser()`; `user_id` solo aparece como `user.id` (sesión)
  en `insert`/`eq`. Los cuerpos solo leen `threadId`/`message`/`title`/`file`.
- [x] **RLS activo en todas las tablas** (heredado de 0001/0002/0003; no modificado).
- [x] **Cabeceras de seguridad** verificadas en runtime (`next start` + `curl -I`):
  presentes en respuestas 200 y 307.

## Propuesta de CSP (no aplicada — para una pasada dedicada)
Cabecera candidata, a inyectar con nonce por request vía middleware (no como string
estático, que rompería los scripts inline de Next):
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-<generado-por-request>';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self' https://<proyecto>.supabase.co;   /* SSE de /api/chat + REST/embed */
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```
Requiere: middleware que genere el nonce, lo propague a `<Script>`/estilos y lo escriba
en la cabecera; pruebas de que el streaming SSE y la hidratación no se rompen. Fuera del
alcance "no romper el chat antes de los testers".

## Restricciones respetadas
No se tocó UI, `lib/rag.ts`, `lib/llm.ts`, migraciones ni la Edge Function `embed`. Los
únicos cambios funcionales en rutas son el 404 y el rate limiting descritos. `next.config.ts`,
`.env.example` y `scripts/` no están entre las áreas restringidas.

## Verificación
- `npm run typecheck` ✅ (0 errores)
- `npm run lint` ✅ (0 errores/warnings)
- `npm run build` ✅ (9 rutas; `/api/chat` sigue en 136 B → sin regresión de bundle)
- Cabeceras de seguridad ✅ verificadas con `next start` + `curl -I` (200 y 307).
- `scripts/security-check.ts` ✅ ejecutable (tsx); guard de entorno probado (sale 1 si
  faltan variables). Ejecución contra el proyecto real: pendiente de Luis.

## Pendientes que hereda el siguiente agente / Luis
- **Luis**: ejecutar `scripts/security-check.ts` contra el proyecto (con 0001/0002/0003
  aplicadas y `npm run dev` para los vectores 9–11) y adjuntar la salida real al PR.
- Configurar `RATE_LIMIT_PER_HOUR` / `RATE_LIMIT_UPLOADS_DAY` en Vercel si se desean
  valores distintos de los defaults (40 / 10).
- Decidir sobre la **CSP** (propuesta arriba) y sobre retirar la factory admin no usada.

## Notas de auditoría
(Lo completa el auditor.)
