# Control de cambios — AG02 (sesión 3) · Pipeline RLHF

| Campo | Valor |
|---|---|
| Agente | AG02 — Datos / RAG (sesión 3) |
| Rama | agent/02c-rlhf |
| Worktree | wt-modelocfo-ag02c |
| Fecha | 2026-06-15 |
| Estado | PR draft |

## Alcance ejecutado
Pipeline de datos para RLHF: captura estructurada del feedback humano (👍/👎 +
comentario) sobre las respuestas del asistente y exportación a JSONL formato
Alpaca para reentrenar el Oracle (Mistral 7B + LoRA Unsloth). Solo datos: migración,
script y documentación. Sin tocar UI, RAG, LLM ni rutas API existentes.

## Archivos clave creados/modificados
- `supabase/migrations/0004_rlhf.sql` — tabla `feedback_signals` con todos los
  constraints (FKs `on delete cascade`, `rating` check, `comment` ≤ 500 chars,
  `is_first_session` default false, `unique (user_id, message_id)`). RLS owner para
  `select/insert/update` **sin policy de DELETE** (el borrado queda al service
  role). Índices `(rating, created_at)` y `(is_first_session, rating)`. Grant
  `select/insert/update` a `authenticated`. No introduce funciones, así que no hay
  execute que revocar.
- `scripts/export-rlhf.ts` — exporta JSONL Alpaca. Empareja cada señal con la
  respuesta del asistente (`message_id`) y el mensaje de usuario inmediatamente
  anterior del hilo; anexa `[CORRECCIÓN SUGERIDA: …]` en negativas con comentario;
  descarta huérfanas; marca `is_first_session`; escribe a
  `exports/rlhf_{timestamp}.jsonl` (o `--output`); imprime resumen detallado.
- `docs/RLHF_PIPELINE.md` — flujo del dato, umbrales de exportación, peso x3 de
  primera sesión, uso con Unsloth (ref. a `MODAL_DEPLOY.md`) y lectura del resumen.
- `.gitignore` — añadido `exports/` (los `*.jsonl` ya estaban blindados).
- `package.json` — script `export-rlhf` (paridad con `seed`).

## Decisiones técnicas tomadas
1. **DELETE solo service role = ausencia de policy de DELETE.** Con RLS activo, sin
   policy el `authenticated` no puede borrar; el service role bypasea RLS. Re-votar
   es `UPDATE` (lo permite la unique `(user_id, message_id)`).
2. **`instruction` = copia espejada de `SYSTEM_BASE`, no import del route.** El
   script de datos no debe importar código de runtime edge (`app/api/chat/route.ts`);
   se replica el prompt base con un comentario de "mantener en sync". Respeta la
   restricción de no tocar rutas.
3. **Mensajes del asistente pre-cargados en lote** (`.in('id', …)`) y mensaje de
   usuario previo por señal: correcto y simple para la escala del banco de pruebas.
   `messages` no tiene `user_id` (tenencia por hilo), así que el emparejamiento es
   por `thread_id` + `created_at`.
4. **`/api/feedback` documentada pero NO creada.** La ruta y el control 👍/👎 son de
   UI/API (otro agente); aquí solo se define el contrato de datos que esperan.
5. **Resumen con números fríos** (procesadas, positivas/negativas, primera sesión,
   exportados/descartados) — interpretación en `docs/RLHF_PIPELINE.md §6`.

## Verificación
- `npm run typecheck` ✅ (0 errores)
- `npm run lint` ✅ (0 errores/warnings)
- `npm run build` ✅ (rutas sin cambios; el script no entra en el bundle web)
- Smoke test del script: `npx tsx scripts/export-rlhf.ts` sin credenciales →
  aborta con mensaje claro y `exit 1` (carga y guard correctos).
- Verificación end-to-end real (con datos en Supabase) pendiente de Luis — ver abajo.

## Pendientes que hereda el siguiente agente / Luis
- **Luis**: aplicar `0004_rlhf.sql` en Supabase. Luego, con feedback real, correr
  `SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/export-rlhf.ts` y revisar el resumen.
- **UI/API**: implementar `POST /api/feedback` (resolver `user_id` server-side,
  upsert por `(user_id, message_id)`) y el control 👍/👎 en la respuesta del
  asistente, según el contrato de `docs/RLHF_PIPELINE.md §1`.
- `is_first_session`: el origen del flag (cómo se marca la primera sesión) lo define
  quien implemente `/api/feedback`; la tabla y el export ya lo soportan.

## Notas de auditoría
(Lo completa el auditor.)
