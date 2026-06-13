# SWITCH_MODEL — Pasar de `gpt-4o-mini` al modelo CFO propio

Procedimiento exacto para que ModeloCFO deje de hablar con `gpt-4o-mini` y pase
a usar **el Oracle** — nuestro modelo fine-tuneado (Mistral 7B + LoRA) servido
con vLLM en Modal.

**La idea clave:** cambiar de proveedor es **solo configuración**. Todo el
tráfico al LLM pasa por `lib/llm.ts`, que usa el SDK `openai` únicamente como
cliente de un protocolo HTTP compatible. No se toca ni una línea de código: se
cambian **tres variables de entorno** en Vercel.

---

## Requisito previo: el endpoint debe existir

Antes de tocar nada en la app, el modelo tiene que estar **desplegado y
respondiendo** en Modal. Ese pipeline (merge del LoRA con Unsloth →
cuantización AWQ → `vllm serve` en una L4 con scale-to-zero) está documentado
paso a paso en **[`docs/MODAL_DEPLOY.md`](MODAL_DEPLOY.md)**. Sigue esa guía
hasta tener:

- La **URL pública** del web server de Modal
  (p. ej. `https://tu-org--modelo-cfo-vllm-serve.modal.run`).
- La **API key** del endpoint (el Secret `modelo-cfo-llm` de Modal).
- El **id del modelo** que devuelve `GET /v1/models` (normalmente el repo/ruta
  que pasaste a `vllm serve`, p. ej. `tu-org/modelo-cfo-awq`).

Verifica que responde **antes** de cambiar la app:

```bash
curl https://tu-org--modelo-cfo-vllm-serve.modal.run/v1/chat/completions \
  -H "Authorization: Bearer <API_KEY_DEL_ENDPOINT>" \
  -H "Content-Type: application/json" \
  -d '{"model":"tu-org/modelo-cfo-awq","messages":[{"role":"user","content":"hola"}]}'
```

Si esto responde, continúa. Si no, el problema está en Modal, no en la app — no
sigas hasta resolverlo (ver el cold start y las notas operativas en
`docs/MODAL_DEPLOY.md`).

---

## El cambio: tres variables de entorno

| Variable | Fase 1 (hoy) | Fase 2 (Oracle en Modal) |
|---|---|---|
| `LLM_BASE_URL` | `https://api.openai.com/v1` | `https://tu-org--modelo-cfo-vllm-serve.modal.run/v1` |
| `LLM_API_KEY` | `sk-…` (OpenAI) | el valor del Secret `modelo-cfo-llm` de Modal |
| `LLM_MODEL` | `gpt-4o-mini` | `tu-org/modelo-cfo-awq` (el id de `GET /v1/models`) |

Reglas:

- **`LLM_BASE_URL` termina en `/v1`** (vLLM expone la API ahí, igual que OpenAI).
- **`LLM_MODEL` debe coincidir exactamente** con el id que devuelve
  `GET /v1/models` del servidor vLLM, o el LLM responderá `404 model not found`.

---

## Procedimiento en producción (Vercel)

1. Vercel → tu proyecto → **Settings → Environment Variables**.
2. Edita las tres variables (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`) con los
   valores de la columna **Fase 2**, en el entorno **Production** (y Preview si
   lo usas para validar).
3. **Redeploy:** las variables solo se aplican en un nuevo despliegue.
   Deployments → último → **⋯ → Redeploy**.
4. **Smoke test:** abre el chat en producción y manda un mensaje. La primera
   respuesta tras un periodo de inactividad puede tardar (**cold start** de
   Modal: decenas de segundos mientras arranca el contenedor y carga el modelo);
   es normal. Si necesitas latencia constante, sube `min_containers=1` en Modal.

> **Probar en local primero (recomendado):** haz el mismo cambio en `.env.local`
> y arranca `npm run dev`. `lib/llm.ts` lee las variables del entorno igual en
> local que en Vercel. Cuando funcione en local, replícalo en Vercel.

---

## Rollback

Si el modelo propio falla, **volver a `gpt-4o-mini` es revertir las tres
variables** a la columna «Fase 1» y redeploy. El código es idéntico en ambos
casos, así que el rollback es inmediato y sin riesgo.

---

## Checklist de corte

- [ ] Modelo desplegado en Modal y `GET /v1/models` lista el id esperado
      (ver `docs/MODAL_DEPLOY.md`).
- [ ] `curl` directo al endpoint responde.
- [ ] (Opcional) Validado en local con `.env.local` + `npm run dev`.
- [ ] `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` actualizadas en Vercel
      (Production).
- [ ] Redeploy hecho.
- [ ] Smoke test del chat en producción OK (contando el cold start).
- [ ] Plan de rollback claro (revertir las 3 variables).
