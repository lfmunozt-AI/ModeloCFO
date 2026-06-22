# Pipeline RLHF — ModeloCFO

Cómo ModeloCFO captura el feedback humano sobre las respuestas del asistente y lo
convierte en un dataset de reentrenamiento para el Oracle (Mistral 7B + LoRA con
Unsloth). Owner: AG02 (datos). Artefactos: `supabase/migrations/0004_rlhf.sql`,
`scripts/export-rlhf.ts`.

## 1. Qué se captura y cómo fluye el dato

```
Usuario pulsa 👍/👎 en una respuesta del asistente (UI)
        │
        ▼
POST /api/feedback   ── valida sesión · resuelve user_id server-side
        │              (no acepta user_id del cliente)
        ▼
tabla public.feedback_signals   ── una fila por (user_id, message_id)
```

Cada fila de `feedback_signals` guarda:

| Campo | Significado |
|---|---|
| `message_id` | la respuesta del asistente valorada (FK a `messages`) |
| `thread_id` | el hilo donde ocurrió (FK a `threads`) |
| `rating` | `positive` (👍) o `negative` (👎) |
| `comment` | corrección opcional del usuario (≤ 500 chars), útil en 👎 |
| `is_first_session` | si la señal proviene de la primera sesión del usuario |
| `user_id` | dueño de la señal (RLS) |

Reglas de integridad clave (ver migración):

- **Una señal por mensaje y usuario** (`unique (user_id, message_id)`): re-votar es
  un `UPDATE`, no una fila nueva.
- **RLS owner** para `select/insert/update`. **No hay borrado para el usuario**: el
  `DELETE` queda reservado al *service role* (purga/anonimización administrativa).
- La ruta `/api/feedback` (UI/backend, fuera del alcance de datos) debe resolver
  `user_id` en el servidor y nunca confiar en el cliente.

> Nota: la tabla y el script son responsabilidad de datos (AG02). La ruta
> `/api/feedback` y el control 👍/👎 en la interfaz los implementa el agente de
> UI/API; este documento describe el contrato de datos que esperan.

## 2. Cuándo exportar

El feedback es escaso al principio: no reentrenar con ruido. Recomendación mínima
**antes del primer ciclo de reentrenamiento**:

- **≥ 50 señales positivas**, o
- **≥ 20 señales negativas** (las negativas con `comment` son especialmente
  valiosas: traen la corrección explícita).

Por debajo de esos umbrales, el LoRA tenderá a sobreajustar a un puñado de casos.

## 3. Señales de primera sesión = datos de mayor peso

Las filas con `is_first_session = true` capturan el momento más crítico del
producto (la primera impresión del usuario). El pipeline de entrenamiento externo
les da **peso triple** (x3): se duplican/triplican o se ponderan en el sampler.

- El JSONL marca cada par con `"is_first_session": true|false` para que el
  entrenamiento aplique ese peso.
- El script `export-rlhf.ts` **las cuenta e imprime por separado** en el resumen,
  para vigilar su proporción dentro del dataset.

## 4. Exportar el dataset (formato Alpaca para Unsloth)

```bash
SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/export-rlhf.ts
# o, con destino explícito:
SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/export-rlhf.ts --output exports/mi_dataset.jsonl
```

Salida: `exports/rlhf_{timestamp}.jsonl` (la carpeta `exports/` está en
`.gitignore`: los datasets **nunca** se commitean a este repo público).

Cada línea es un registro Alpaca:

```json
{
  "instruction": "<system_prompt_base>",
  "input": "<mensaje del usuario>",
  "output": "<respuesta del asistente>",
  "rating": "positive",
  "is_first_session": false
}
```

Cómo se construye cada par (ver el script para el detalle):

1. Por cada señal se toma la respuesta del asistente (`message_id`).
2. Se busca el **mensaje de usuario inmediatamente anterior** en el mismo hilo
   (`role = 'user'`, `created_at <` el de la respuesta, el más reciente).
3. En señales **negativas con `comment`**, se anexa al `output`:
   `\n[CORRECCIÓN SUGERIDA: {comment}]` — así el modelo aprende la dirección de
   la corrección, no solo que la respuesta fue mala.
4. Solo se exportan pares donde **existen ambos mensajes**; las señales huérfanas
   (respuesta o pregunta borradas) se descartan y se cuentan aparte.
5. `instruction` es el prompt base del sistema (espejo de `SYSTEM_BASE` en
   `app/api/chat/route.ts`).

## 5. Entrenar con Unsloth

El JSONL sale ya en el formato Alpaca que consume Unsloth. El flujo de fine-tuning
+ despliegue del Oracle está en [`docs/MODAL_DEPLOY.md`](./MODAL_DEPLOY.md)
(Mistral 7B → LoRA con Unsloth → merge → AWQ → vLLM en Modal). En resumen:

1. Sube `exports/rlhf_*.jsonl` al entorno de entrenamiento (no a este repo).
2. Carga con el formato Alpaca (`instruction` / `input` / `output`).
3. Aplica el **peso triple** a los registros con `is_first_session = true`.
4. Entrena el LoRA, fusiona, cuantiza y redepliega como en `MODAL_DEPLOY.md`.
5. Cambiar el Oracle en producción = cambiar `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`
   (la app es agnóstica de proveedor vía `lib/llm.ts`).

## 6. Interpretar los números fríos del resumen

El script imprime, sin adornos:

```
Total señales procesadas : N      ← cuánto feedback hay en bruto
  Positivas              : P      ← refuerzo de lo que ya funciona
  Negativas              : Ngv    ← señal de corrección (más valiosa con comment)
Primera sesión (peso x3) : F (exportadas: Fe)   ← datos críticos de 1ª impresión
Pares exportados         : E      ← ejemplos de entrenamiento utilizables
Descartados (huérfanos)  : D      ← señales sin par completo (no entrenables)
```

Lectura rápida:

- **E ≪ N**: muchas señales huérfanas → revisa borrados de mensajes o integridad.
- **Ngv alto con pocos `comment`**: hay rechazo pero poca guía; anima a comentar.
- **F alto**: el dataset pesa mucho hacia la primera sesión; vigila que el x3 no
  desbalancee al modelo hacia ese único contexto.
- Compara **P vs Ngv** contra los umbrales de §2 antes de lanzar un ciclo.
