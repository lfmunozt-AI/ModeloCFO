# Control de cambios — AG02 (sesión 2) · Memoria conversacional

| Campo | Valor |
|---|---|
| Agente | AG02 — Datos / RAG (sesión 2) |
| Rama | agent/02-memoria |
| Worktree | wt-modelocfo-ag02b |
| Fecha | 2026-06-13 |
| Estado | PR draft |

## Alcance ejecutado
El RAG ya indexaba documentos, pero el texto del chat no se embebía y el modelo
negaba tener memoria. Esta sesión añade **memoria conversacional**: cada turno
relevante se embebe como recuerdo y el retrieval se unifica (documentos + memoria)
en una sola consulta. El system prompt deja claro al modelo que dispone de memoria.

## Archivos clave creados/modificados
- `supabase/migrations/0003_memory.sql` — tabla `memory_chunks` (`embedding
  vector(384)`, RLS owner por `user_id`, índice HNSW coseno, grants a
  `authenticated`) + función **`match_context(vector(384), int)`** SECURITY INVOKER
  que hace UNION de `document_chunks` + `memory_chunks` filtrando por `auth.uid()`,
  con `revoke` de `public`/`anon` y `grant execute` solo a `authenticated`.
- `lib/rag.ts` — nueva `ingestMemoryExchange()` (embebe el par Usuario/Asistente en
  `memory_chunks`; no lanza; omite mensajes < 15 chars). `retrieveContext()` ahora
  llama a `match_context` (top-5 global docs+memoria); etiqueta cada fuente con el
  nombre del documento o "conversación de DD/MM/AAAA". `formatContext()` **intacto**
  (delimitación `<<< >>>` anti-inyección sin tocar).
- `app/api/chat/route.ts` — **solo** `SYSTEM_BASE` (el modelo sabe que tiene
  memoria y no debe negarla) y el `onComplete` (ingesta del turno tras persistir la
  respuesta) + el import de `ingestMemoryExchange`. Nada más del route cambia.

## Decisiones técnicas tomadas
1. **`match_context` en SQL (UNION ALL), no dos RPC en código.** Un único
   `ORDER BY similarity DESC LIMIT k` sobre la unión devuelve el top-5 GLOBAL
   exacto en una sola llamada. Mezclar dos RPC obligaría a sobre-recuperar (k de
   cada fuente) y reordenar en cliente, sin garantía de ranking idéntico en
   empates. SECURITY INVOKER + filtro `auth.uid()` en ambas ramas = mismo modelo
   de aislamiento que `match_chunks`.
2. **Ingesta de memoria `await`-eada dentro del `onComplete`, no `void`.** El
   `onComplete` de `streamChat` se espera ANTES de cerrar el stream, pero los
   tokens ya se enviaron al usuario en esa fase; por tanto, esperar la escritura de
   memoria **no bloquea el stream visible** y sí **garantiza la persistencia** antes
   de que el worker edge sea reclamado (un `void` fire-and-forget se perdería en
   edge y el recuerdo no se guardaría → el test de aceptación fallaría de forma
   intermitente). Sigue siendo "fire-and-forget" en lo esencial: `ingestMemoryExchange`
   nunca lanza (captura y `console.error`), así que un fallo de embeddings jamás
   rompe el chat.
3. **Umbral de trivialidad (15 chars) dentro de `ingestMemoryExchange`.** Evita
   guardar saludos/"ok"/"gracias" como recuerdos ruidosos. Centralizado en la
   función de datos, no en el route.
4. **Reutilización de la Edge Function `embed` tal cual** (gte-small/384) y del
   `supabase` de la request (su sesión) — sin nuevas dependencias ni cambios en
   `lib/llm.ts`, UI, `/api/documents` ni el resto del route.
5. **`match_chunks` de 0002 se conserva** (sigue desplegada y con grant); el chat ya
   no la usa, pero no se elimina para no romper nada externo.

## Verificación
- `npm run typecheck` ✅ (0 errores)
- `npm run lint` ✅ (0 errores/warnings)
- `npm run build` ✅ (10 rutas). `/api/chat` = 136 B → `unpdf` sigue fuera del
  bundle edge; `ingestMemoryExchange` (solo fetch + supabase) es edge-safe.
- Aviso preexistente de `@supabase/ssr` (`process.version` en edge) heredado; no
  bloquea el build.

## Criterio de aceptación (cross-thread)
Spec: en hilo A → "mi número de socio del club es 8841"; en hilo B nuevo →
"¿cuál es mi número de socio?" debe responder **8841** citando que se mencionó
antes. Mecánica que lo cumple:
1. Turno en A: `onComplete` embebe "Usuario: mi número de socio… / Asistente: …"
   (> 15 chars) en `memory_chunks` con `thread_id = A`.
2. Pregunta en B: `retrieveContext` → `match_context` recupera ese recuerdo
   (mismo `user_id`, sin filtrar por hilo) etiquetado "conversación de DD/MM/AAAA",
   se inyecta delimitado, y `SYSTEM_BASE` instruye a usarlo en vez de negar memoria.

Verificación end-to-end real (subir env + correr el flujo) pendiente de Luis tras
aplicar la migración y desplegar — ver abajo.

## Pendientes que hereda el siguiente agente / Luis
- **Luis**: aplicar `0003_memory.sql` en Supabase (la Edge Function `embed` ya está
  desplegada desde 0002; se reutiliza sin cambios). Luego validar el flujo
  cross-thread del criterio de aceptación.
- Posible mejora futura: poda/expiración de `memory_chunks` antiguos o de baja
  relevancia para acotar el crecimiento. Fuera de alcance de esta sesión.

## Notas de auditoría
(Lo completa el auditor.)
