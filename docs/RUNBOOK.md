# RUNBOOK — Operación de ModeloCFO

Guía operativa para Luis (administrador). Cubre las tareas recurrentes:
rotar claves, ver logs, gestionar testers, borrar datos (GDPR) y diagnosticar el
LLM. Todas las operaciones sensibles se hacen desde los dashboards de **Vercel**
y **Supabase**; nunca hace falta tocar código.

> **Recordatorio de seguridad:** el `SUPABASE_SERVICE_ROLE_KEY` y las claves del
> LLM solo viven en variables de entorno (Vercel) y, en local, en `.env.local`
> (que está en `.gitignore`). Nunca se commitean ni se comparten por canales
> inseguros.

---

## 1. Rotar claves en Vercel

Cuando una clave se filtra o caduca (LLM, Supabase, service role):

1. **Genera la clave nueva en su origen:**
   - LLM (`LLM_API_KEY`): en el proveedor (OpenAI → API keys, o el Secret de
     Modal — ver `docs/SWITCH_MODEL.md`). Revoca la antigua.
   - Supabase (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`):
     Supabase → **Project Settings → API → Rotate**.
2. **Actualiza la variable en Vercel:** Vercel → tu proyecto → **Settings →
   Environment Variables** → edita el valor en el entorno correcto
   (Production / Preview / Development) → **Save**.
3. **Redeploy:** las variables solo se aplican en un nuevo despliegue. Vercel →
   **Deployments** → último deploy → **⋯ → Redeploy** (sin caché de build).
4. **Verifica:** abre la app y manda un mensaje; revisa los logs (sección 2) si
   falla.

> Cambiar **de modelo** (no solo rotar su clave) son las tres variables
> `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` — ver `docs/SWITCH_MODEL.md`.

---

## 2. Ver logs

**Vercel (app / route handlers):**
- Vercel → tu proyecto → **Logs** (u **Observability → Runtime Logs**). Filtra
  por ruta (`/api/chat`, `/api/documents`) y por nivel de error. Los `429`
  (rate limit) y los errores del LLM aparecen aquí.

**Supabase (base de datos, auth, Edge Functions):**
- Supabase → **Logs** → elige la fuente:
  - **Postgres / API**: errores de RLS, queries.
  - **Auth**: registros, logins fallidos, recuperaciones de contraseña.
  - **Edge Functions → `embed`**: fallos de generación de embeddings (rompen la
    ingesta de documentos, no el chat).

---

## 3. Resetear la contraseña de un tester

La app no tiene UI de recuperación; se hace desde Supabase:

1. Supabase → **Authentication → Users** → busca el usuario por email.
2. Opción A — **enviar email de recuperación:** menú **⋯ → Send password
   recovery**. El tester recibe un enlace para fijar contraseña nueva.
3. Opción B — **fijarla tú directamente:** menú **⋯ → Reset password** /
   editar el usuario y establecer una contraseña, y comunícasela por un canal
   seguro.

> Requiere que el proveedor de email esté configurado en Supabase para la
> opción A. La opción B no depende del email.

---

## 4. Borrar los datos de un usuario (GDPR)

Todas las tablas referencian `auth.users(id)` (o el hilo) con
`ON DELETE CASCADE`, así que **borrar arrasa en cascada**:

```
auth.users(id) ──cascade──► threads ──cascade──► messages
                        │              └─────────► memory_chunks (por thread_id)
                        └─► documents ──cascade──► document_chunks
                        └─► memory_chunks (por user_id)
```

### Opción A — borrar TODO de un usuario (incluida la cuenta)

La vía más limpia: elimina la cuenta de auth y todo lo demás cae en cascada.

- Supabase → **Authentication → Users** → usuario → **⋯ → Delete user**.

Esto borra `threads`, `messages`, `documents`, `document_chunks` y
`memory_chunks` de ese usuario automáticamente.

### Opción B — borrar solo los datos, conservando la cuenta

Si el tester sigue activo pero pide borrar su contenido, ejecuta en el
**SQL Editor** de Supabase (sustituye el UUID; consíguelo en Authentication →
Users):

```sql
-- Reemplaza '<USER_ID>' por el uuid real del usuario.
delete from public.threads   where user_id = '<USER_ID>';  -- arrastra messages y memory_chunks
delete from public.documents where user_id = '<USER_ID>';  -- arrastra document_chunks
-- Red de seguridad por si quedara memoria huérfana referenciada solo por user_id:
delete from public.memory_chunks where user_id = '<USER_ID>';
```

> Verificación: `select count(*) from public.messages m join public.threads t on
> t.id = m.thread_id where t.user_id = '<USER_ID>';` debe dar `0`.

---

## 5. Qué hacer si el LLM no responde

Síntoma típico: el chat muestra un evento de error en el stream, o se queda sin
respuesta. `lib/llm.ts` propaga el error del proveedor como un evento SSE
(`data: {"error":"…"}`). Diagnóstico de mayor a menor probabilidad:

1. **Variables de entorno mal/ausentes.** `streamChat` lanza
   `Falta la variable de entorno LLM_…` si falta alguna. Revisa
   `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` en Vercel (Production) y haz
   redeploy si las cambiaste (sección 1).

2. **Clave inválida o sin saldo** (proveedor externo). Mensaje `401`/`429` en
   los logs de Vercel. Rota la clave (sección 1) o revisa la cuenta del
   proveedor.

3. **Endpoint inalcanzable o `LLM_MODEL` incorrecto.** Prueba el endpoint sin la
   app:
   ```bash
   curl $LLM_BASE_URL/chat/completions \
     -H "Authorization: Bearer $LLM_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"'"$LLM_MODEL"'","messages":[{"role":"user","content":"hola"}]}'
   ```
   - Si da `404 model not found`: `LLM_MODEL` no coincide con `GET /v1/models`.
   - Si no conecta: revisa `LLM_BASE_URL` (debe terminar en `/v1`).

4. **Modal en cold start** (cuando ya se usa el modelo propio). El primer
   request tras escalar a cero tarda decenas de segundos en arrancar el
   contenedor + cargar el modelo. No es un fallo: reintenta. Si necesitas
   latencia constante, sube `min_containers=1` en Modal (ver
   `docs/MODAL_DEPLOY.md`). El `Volume` de caché de HF acelera arranques
   posteriores.

5. **Rate limit propio** (`429` con `Retry-After`). El usuario superó
   `RATE_LIMIT_PER_HOUR`. Es esperado; ajusta el valor en Vercel si hace falta.

6. **Streaming roto pero el modelo responde.** Si el `curl` directo funciona
   pero el chat no, revisa los logs de runtime de `/api/chat` en Vercel
   (errores del runtime edge). Recuerda que `onComplete` persiste la respuesta
   al cerrar el stream: un fallo ahí impide guardar el mensaje del asistente.

---

## Referencias

- Variables de entorno: `.env.example`
- Cambiar de modelo: `docs/SWITCH_MODEL.md` · `docs/MODAL_DEPLOY.md`
- Esquema y RLS: `supabase/migrations/0001..0003`
- Auditoría de aislamiento: `scripts/security-check.ts` (ver `README.md`)
