# ModeloCFO

Chat web multitenant minimalista para probar un modelo CFO fine-tuneado
(Mistral 7B + LoRA). Máximo 5 usuarios. Cada usuario tiene sus propios hilos de
conversación, puede subir documentos (PDF/TXT/MD) que el asistente usa como
contexto (RAG) y dispone de memoria entre conversaciones.

El LLM se consume vía una API **compatible con la de OpenAI**: **hoy**
`gpt-4o-mini`, **mañana** un endpoint vLLM en Modal — sin tocar código, solo tres
variables de entorno (ver [`docs/SWITCH_MODEL.md`](docs/SWITCH_MODEL.md)).

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind v4 · Supabase
(auth · Postgres · pgvector · Edge Functions) · SDK `openai` apuntando a
`LLM_BASE_URL` · Vercel.

## Cómo funciona (un vistazo)

- **Auth:** email + contraseña (Supabase Auth).
- **Chat:** `POST /api/chat` → stream SSE token a token desde el LLM (runtime
  edge). El hilo se crea solo con el primer mensaje.
- **RAG:** los documentos subidos se trocean y se embeben (`gte-small`, 384-dim,
  vía una Edge Function de Supabase) en `pgvector`. Cada turno relevante del chat
  también se guarda como «memoria». En cada pregunta se recupera el contexto más
  parecido (documentos + memoria) y se inyecta en el prompt.
- **Multitenant:** RLS por `user_id` en todas las tablas; un usuario nunca ve los
  datos de otro.

Detalle de arquitectura y reglas en [`CLAUDE.md`](CLAUDE.md) y
[`docs/FASE1_RESUMEN.md`](docs/FASE1_RESUMEN.md).

---

## Setup local (paso a paso)

Requisitos: **Node 20+** y la **CLI de Supabase**
(`npm install -g supabase`, o `npx supabase ...`).

### 1. Clonar e instalar

```bash
git clone <URL-del-repo> ModeloCFO
cd ModeloCFO
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

Rellena `.env.local` con tus valores reales (nunca se commitea):

| Variable | De dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `LLM_BASE_URL` | `https://api.openai.com/v1` (Fase 1) |
| `LLM_API_KEY` | tu clave del proveedor LLM (`sk-…`) |
| `LLM_MODEL` | `gpt-4o-mini` (Fase 1) |
| `SUPABASE_SERVICE_ROLE_KEY` | **solo** para `npm run seed` / `security-check`; **nunca** se commitea ni se expone al cliente |
| `RATE_LIMIT_PER_HOUR` | opcional, default 40 |
| `RATE_LIMIT_UPLOADS_DAY` | opcional, default 10 |

### 3. Enlazar el proyecto Supabase y aplicar el esquema

```bash
supabase login                       # una vez
supabase link --project-ref <TU-REF> # la ref está en la URL del dashboard
supabase db push                     # aplica supabase/migrations/0001..0003
```

> Alternativa sin CLI: pega el contenido de `supabase/migrations/0001_init.sql`,
> `0002_rag.sql` y `0003_memory.sql` (en ese orden) en el **SQL Editor** del
> dashboard.

### 4. Desplegar la Edge Function de embeddings

El RAG necesita la función `embed` (calcula los vectores con `gte-small`):

```bash
supabase functions deploy embed
```

### 5. Arrancar

```bash
npm run dev          # http://localhost:3000
```

Abre `http://localhost:3000`, regístrate con email + contraseña y empieza a
chatear. Sube un PDF/TXT/MD con el clip 📎 para probar el RAG.

> **(Opcional) Datos de prueba:** con `SUPABASE_SERVICE_ROLE_KEY` en el entorno,
> `npm run seed` crea 2 usuarios sintéticos con un hilo y un documento cada uno.

---

## Invitar a los 5 testers

El producto está limitado por convención a **5 usuarios**. Dos vías:

- **Auto-registro (lo más simple):** comparte la URL de la app; cada tester
  entra a `/login`, pulsa «¿No tienes cuenta? Regístrate» y crea email +
  contraseña. (Si tienes activada la confirmación de email en Supabase, deberá
  confirmar el correo antes de iniciar sesión.)
- **Alta desde el dashboard:** Supabase → **Authentication → Users → Add user**,
  fija email + contraseña, y comparte las credenciales. Útil si prefieres
  controlar quién entra (puedes desactivar el auto-registro en
  **Authentication → Providers → Email → "Allow new users to sign up"**).

Para resetear la contraseña de un tester o borrar sus datos, ver
[`docs/RUNBOOK.md`](docs/RUNBOOK.md).

---

## Tests

Los tests no necesitan Supabase, red ni variables de entorno: Supabase, el RAG y
el LLM están mockeados.

```bash
npm test            # toda la suite una vez (vitest run)
npm run test:watch  # modo watch
npx vitest run tests/lib   # solo unit tests de lib/
npx vitest run tests/api   # solo route handlers
```

CI corre `lint → typecheck → build → test` en cada PR a `main`
(`.github/workflows/ci.yml`).

## Auditoría de seguridad (aislamiento multitenant)

`scripts/security-check.ts` siembra datos de un usuario A e intenta accederlos
como usuario B por cada vía de la app (12 vectores: REST anon, RPC y route
handlers). Sale con código 1 ante cualquier fuga.

```bash
export NEXT_PUBLIC_SUPABASE_URL=...        # proyecto con 0001/0002/0003 aplicadas
export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...       # SOLO local; nunca se commitea
npm run dev                                # en otra terminal (vectores 9–11)
npx tsx scripts/security-check.ts
```

---

## Scripts

| Script              | Qué hace                                   |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | Servidor de desarrollo                     |
| `npm run build`     | Build de producción (criterio de aceptación)|
| `npm run start`     | Sirve el build                             |
| `npm run lint`      | ESLint                                     |
| `npm run typecheck` | `tsc --noEmit`                             |
| `npm test`          | Suite de tests (Vitest)                    |
| `npm run seed`      | Datos sintéticos (requiere service role)   |

## Documentación

- [`CLAUDE.md`](CLAUDE.md) — arquitectura, estructura y reglas del proyecto.
- [`docs/FASE1_RESUMEN.md`](docs/FASE1_RESUMEN.md) — resumen ejecutivo de la Fase 1.
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — operación: rotar claves, logs, reset de
  contraseña, borrado GDPR, qué hacer si el LLM no responde.
- [`docs/SWITCH_MODEL.md`](docs/SWITCH_MODEL.md) — cambiar de `gpt-4o-mini` al
  modelo propio en Modal.
- [`docs/MODAL_DEPLOY.md`](docs/MODAL_DEPLOY.md) — servir el LoRA propio en Modal (vLLM).
