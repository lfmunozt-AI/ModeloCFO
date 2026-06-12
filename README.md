# ModeloCFO

Chat web multitenant minimalista para probar un modelo CFO fine-tuneado
(Mistral 7B LoRA). 5 usuarios máximo. El LLM se consume vía una API compatible
con OpenAI: **hoy** `gpt-4o-mini`, **mañana** un endpoint vLLM en Modal — sin
tocar código, solo variables de entorno.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind v4 · Supabase (auth/db) ·
SDK `openai` apuntando a `LLM_BASE_URL` · Vercel.

## Arranque local

```bash
cp .env.example .env.local   # rellena Supabase + LLM
npm install
npm run dev                  # http://localhost:3000
```

Aplica el esquema de base de datos (`supabase/migrations/0001_init.sql`) en tu
proyecto Supabase antes de usar el chat.

## Scripts

| Script              | Qué hace                          |
| ------------------- | --------------------------------- |
| `npm run dev`       | Servidor de desarrollo            |
| `npm run build`     | Build de producción               |
| `npm run start`     | Sirve el build                    |
| `npm run lint`      | ESLint                            |
| `npm run typecheck` | `tsc --noEmit`                    |

## Documentación

- `CLAUDE.md` — arquitectura, estructura y reglas del proyecto.
- `docs/MODAL_DEPLOY.md` — Fase 2: servir el LoRA propio en Modal (vLLM).
