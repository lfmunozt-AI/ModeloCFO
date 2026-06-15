# Control de cambios — AG08 · Prompts y voz (The Consigliere)

| Campo | Valor |
|---|---|
| Agente | AG08 — Especialista en prompts y voz del modelo |
| Rama | agent/08-voice |
| Worktree | wt-modelocfo-ag08 |
| Fecha | 2026-06-15 |
| Estado | PR draft |

## Alcance ejecutado
Se define la voz y el comportamiento exacto de **The Consigliere**, el modelo
en fase de evaluación dentro de **Monoend** (plataforma de andgcore Corporate).
El trabajo es puramente de prompt/voz, sin lógica nueva: (1) se reemplaza la
constante `SYSTEM_BASE` del endpoint de chat por el system prompt definitivo de
The Consigliere; (2) se exportan los tres starters de primera sesión como
módulo reutilizable; (3) se documenta la identidad, tono y reglas en prosa para
lectores no técnicos.

## Archivos clave creados/modificados
- `app/api/chat/route.ts` — **única** modificación: la constante `SYSTEM_BASE`.
  Nuevo system prompt de The Consigliere (identidad/tono, memoria, primera
  sesión con los 3 starters, manejo de feedback negativo). Nada más del archivo
  se tocó.
- `lib/starters.ts` — **nuevo**: `CONVERSATION_STARTERS` (tupla `as const`) y el
  tipo `ConversationStarter`.
- `docs/ORACLE_VOICE.md` — **nuevo**: traducción humana del system prompt
  (identidad, qué es / qué no es, tono, reglas, relación con Monoend y andgcore,
  y cómo evoluciona al cambiar el modelo base — referencia a `SWITCH_MODEL.md`).
- `docs/control/AG08_RESUMEN.md` — **nuevo**: este resumen.

## Decisiones técnicas tomadas
- `SYSTEM_BASE` pasa de array `.join(" ")` a **template literal** multilínea: el
  prompt contiene listas y secciones con saltos de línea significativos (Parte
  A / Parte B, viñetas) que deben preservarse para el modelo.
- Los nombres `gpt-4o-mini`/`OpenAI` aparecen **solo dentro del system prompt**,
  como instrucción al modelo de NO mencionarlos. El system prompt es
  server-side y nunca se renderiza al usuario, por lo que no viola el criterio
  de "texto visible al usuario". `Oracle`/`Sovereign` no aparecen en código ni
  UI (el nombre del archivo `ORACLE_VOICE.md` lo fija el prompt de la tarea y es
  documentación, no UI).
- `lib/starters.ts` se crea como módulo independiente para que la UI
  (WelcomePanel, AG04B) pueda consumir una única fuente de verdad de los
  starters sin duplicarlos; no se modificó la UI (fuera del alcance permitido).

## Verificación
- `npm run typecheck` → **OK** (sin errores).
- `npm run lint` → **OK** (sin warnings ni errores).
- `npm run build` → **OK** (build de producción completo; todas las rutas
  compiladas).
- `SYSTEM_BASE` ≈ 557–683 tokens estimados → **< 800** (criterio cumplido).
- Grep de `oracle|sovereign|gpt-4o-mini|openai` en `components/`, `app/`,
  `lib/starters.ts` → solo aparece en el system prompt server-side de
  `route.ts` (no visible al usuario).

## Pendientes que hereda el siguiente agente
- Cablear `lib/starters.ts` en el `WelcomePanel` para eliminar los starters
  hardcodeados (AG04B) y usar la fuente única. No se hizo aquí por la
  restricción de alcance (solo `SYSTEM_BASE` + archivos nuevos).
- La lógica de "primera sesión" (dos partes) se cumple por instrucción de
  prompt; si se requiere garantía determinista, valdría un test de evaluación
  del modelo contra los 3 starters.

## Notas de auditoría
(Lo completa el auditor.)
