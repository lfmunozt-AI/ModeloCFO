# Guardarraíl de cifras (AG02b)

Capa de **código** (regex + lógica), externa al modelo, que evita que el
asistente entregue **montos monetarios inventados** que el usuario no aportó ni
se derivan de un cálculo. No toca `lib/llm.ts` ni el modelo: envuelve la
respuesta ya generada.

Vive en `lib/guardrail/`. Todo corre sin llamar a ningún LLM (objetivo de
latencia: Piezas 1‑2 en ~ms; Pieza 3 incluido el log en ~1 s).

## Las 4 piezas

| Pieza | Archivo | Qué hace |
|-------|---------|----------|
| 1. Extractor de entrada | `extract.ts` | Del mensaje del usuario saca los **hechos verificados**: `[{valor, etiqueta, moneda}]`. |
| 2. Validador de grounding | `validate.ts` | De la respuesta del modelo extrae toda cifra y la clasifica en aprobada / bloqueada. |
| 3. Política + log | `policy.ts` | Si hay montos inventados, reescribe la frase (modo MVP) y registra metadatos. |
| 4. Esquema de salida | `schema.ts` | Zod: `{ consejo, cifras_usadas: [{valor, fuente}] }`, con parseo **tolerante**. |

`index.ts` expone `runGuardrail(mensajeUsuario, respuestaModelo, opts)` que
encadena las cuatro y devuelve `{ texto_final, bloqueado, hechos, validacion,
estructurada, logEntries }`.

Núcleo compartido: `numbers.ts` (parsing de cifras) y `context.ts` (moneda,
porcentaje, tiempo, etiqueta por proximidad).

## Decisiones de clasificación (Pieza 2)

Para cada cifra de la respuesta:

- **APROBADA — hecho**: coincide (±1 %) con un valor que dio el usuario.
- **APROBADA — concepto**: es un porcentaje (`20%`, `por ciento`) o una regla
  temporal (`3 a 6 meses`, `2 años`). No son montos, son conceptos.
- **APROBADA — cálculo**: se deriva de un hecho por un factor "limpio"
  (fracciones/porcentajes habituales, los porcentajes que la propia respuesta
  menciona, conversiones ×12 / ÷12, o sumas/restas de pares de hechos).
- **BLOQUEADA**: monto absoluto sin respaldo en los datos del usuario ni en un
  cálculo reconocible.

## Política (Pieza 3)

- Sin cifras bloqueadas → respuesta intacta.
- Con bloqueos:
  - **MVP** (por defecto): reemplaza la frase que contiene el monto inventado
    por una petición de dato (`"Para darte esa cifra necesito conocer tu …"`).
  - **passthrough**: no reescribe, solo registra (para medir sin alterar la UX).
- Log → tabla `guardrail_log` (migración `0004_guardrail.sql`). **Solo
  metadatos**: `{ blocked_value, blocked_text, reason, question_hash }`. Nunca
  el mensaje del usuario ni la respuesta del modelo; la pregunta se referencia
  por hash SHA‑256 (16 chars). RLS por `user_id`.

## Convención de números (es/LatAm)

El punto es separador de **miles**, la coma es **decimal**:

| Entrada | Se interpreta |
|---------|---------------|
| `40000` | 40000 |
| `1.200` | 1200 |
| `1.200,50` | 1200.5 |
| `1.200.000` | 1200000 |
| `2000,5` | 2000.5 |

Palabras: `mil`, `millón/millones`, `cien`, `doscientos`, combinaciones
(`cuarenta mil` → 40000, `un millón doscientos mil` → 1200000).

## Qué detecta

- Montos en dígitos y en palabras (hasta miles de millones).
- Moneda/contexto: `euros`/`€` → EUR, `dólares`/`usd` → USD, `pesos` → pesos,
  `$` → genérico, `%`/`por ciento` → porcentaje.
- Etiqueta por proximidad: deuda, ingreso, ahorro, gasto, meta, renta,
  inversión, interés, patrimonio.
- Derivaciones por cálculo simple sobre los hechos del usuario.

## Qué NO detecta (límites conocidos)

Estos son los bordes de las reglas — son intencionales (un guardarraíl de
código no puede razonar como el modelo) y quedan documentados para no
sorprender:

- **Formato ambiguo**: `1.200` siempre es 1200 (mil‑doscientos), nunca 1,2.
  Un decimal escrito con punto (`1.5`) se leerá como miles, no como 1,5.
- **Años / identificadores**: `2024`, números de cuenta o referencias largas se
  tratan como montos si aparecen sin unidad temporal pegada. Pueden generar
  falsos positivos.
- **Palabras‑número compuestas raras** (`millardo`, mezclas poco usuales) tienen
  cobertura parcial.
- **Etiqueta**: es una heurística de cercanía; con varias cifras y contextos
  entremezclados puede asignar una etiqueta vecina. No afecta al grounding (que
  compara **valores**, no etiquetas).
- **Derivación**: solo reconoce factores "limpios" (porcentajes/fracciones
  comunes, ×12, sumas de pares). Un cálculo legítimo con un factor inusual
  (p. ej. interés compuesto a una tasa rara) puede bloquearse de más. Es un
  trade‑off deliberado: preferimos pedir el dato a inventar la cifra.
- **No razona semánticamente**: distingue dinero de porcentaje/tiempo por la
  unidad adyacente, no por el sentido de la frase.

## Integración (pendiente, decisión de Luis)

Esta sesión entrega la capa **standalone + tests**; el chat en vivo
(`app/api/chat/route.ts`) **no se modificó**. El enganche previsto:

```ts
// dentro del onComplete de streamChat, con la respuesta completa bufferizada:
const { texto_final } = await runGuardrail(message, fullText, {
  supabase, userId: user.id,        // persiste el log (opcional)
  mode: "mvp",                      // o "passthrough" para medir
});
// persistir/mostrar `texto_final` en lugar de `fullText`.
```

Implica **bufferizar** la respuesta antes de mostrarla: el flujo actual hace
streaming token‑a‑token, y reescribir una frase exige la respuesta completa. La
UX pasaría de "escribiendo…" a respuesta de una vez (~1 s). Por eso se dejó como
paso aparte para revisión.

La Pieza 4 (Zod) ya valida `{consejo, cifras_usadas}` si el modelo se cambia a
salida estructurada; mientras emita texto plano, `parseModelOutput` lo tolera y
la vía de regex (Piezas 1‑2) sigue siendo la fuente de verdad del grounding.

## Tests

`npm test` (runner nativo `node:test` vía `tsx`, sin framework extra). Cubre los
casos reales que fallaron:

- **A1**: `"Tengo 40000 en deudas"` + respuesta con `1500 de intereses` →
  bloquea 1500, aprueba 40000.
- **C1**: `"Gano 8000 euros"` + respuesta con `meta de 300000` → bloquea
  300000, aprueba 8000.
- **Cálculo válido**: `"Gano 10000"` + `"ahorra 2000 (20%)"` → aprueba todo
  (2000 = 20 % de 10000).
