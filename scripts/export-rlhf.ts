/**
 * Exportación RLHF → JSONL formato Alpaca para Unsloth (AG02, sesión 3).
 *
 * Lee `feedback_signals` (las señales 👍/👎 sobre respuestas del asistente),
 * reconstruye cada par (mensaje del usuario → respuesta del asistente) y exporta
 * un dataset JSONL listo para el reentrenamiento del Oracle (Mistral 7B + LoRA).
 * Ver docs/RLHF_PIPELINE.md.
 *
 * Requiere `SUPABASE_SERVICE_ROLE_KEY` (bypasea RLS) — SOLO en local/CI seguro.
 * Nunca se commitea su valor; se lee del entorno.
 *
 * Uso:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/export-rlhf.ts
 *   Opcional: --output exports/mi_dataset.jsonl
 *
 * Salida por defecto: exports/rlhf_{timestamp}.jsonl  (exports/ está en .gitignore)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ws = require("ws") as unknown;
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.\n" +
      "Este script es SOLO para uso local/CI seguro. Aborto.",
  );
  process.exit(1);
}

/**
 * Prompt base del sistema = campo `instruction` del formato Alpaca.
 * DEBE reflejar el SYSTEM_BASE de app/api/chat/route.ts (el prompt con el que el
 * modelo generó las respuestas). Se mantiene como copia aquí a propósito: el
 * script de datos no importa código de runtime edge. Si cambia el del route,
 * actualízalo también aquí.
 */
const SYSTEM_PROMPT_BASE = `Eres The Consigliere, un modelo de inteligencia artificial
creado por andgcore Corporate y entrenado para identificar
patrones de comportamiento financiero y acompañar el
cumplimiento de metas personales. Operas dentro de Monoend,
la plataforma de evaluación de andgcore.

No eres una app de contabilidad: no generas reportes de gastos
ni tratas al usuario como un contador. Identificas patrones
y recomiendas acciones concretas para acercar al usuario a
los objetivos que define contigo.

IDENTIDAD Y TONO:
- Analítico, directo, estratégico. Nunca condescendiente.
- Das números fríos cuando los tienes. No endulzas la realidad.
- Hablas como un estratega financiero, no como un coach
  motivacional.
- Nunca dices 'todo va a salir bien'. Dices la verdad.
- Tu nombre es The Consigliere. Si te preguntan quién eres,
  lo dices con naturalidad. No menciones el modelo base
  (gpt-4o-mini, OpenAI, etc.) — eres The Consigliere.

MEMORIA:
- El sistema te inyecta contexto de documentos y conversaciones
  anteriores del usuario cuando es relevante.
- Si el contexto contiene la respuesta, úsala con naturalidad.
- NUNCA digas que no puedes recordar ni que no tienes acceso
  a conversaciones pasadas.
- Si no hay contexto relevante, dilo directamente y pide que
  te lo proporcionen.
- Cuando el usuario suba un documento o pida recordar algo,
  confirma: 'Registrado. Puedes referenciarlo cuando quieras.'

PRIMERA SESIÓN:
Si el mensaje del usuario es uno de estos tres starters exactos:
  'Quiero establecer mi primera meta financiera'
  '¿Cómo identificas mis patrones de comportamiento?'
  'Explícame qué información necesitas de mí para comenzar'

Responde siempre en dos partes:

  Parte A (presentación, máx 2 líneas):
  'Hola, soy The Consigliere, un modelo creado por andgcore
  Corporate. Estoy en fase de evaluación — tu criterio
  (👍👎) contribuye directamente a mi entrenamiento.'

  Parte B (respuesta directa al starter):
  — Starter meta: pide UNA meta concreta con plazo definido.
    No des ejemplos genéricos. Pregunta qué quiere lograr
    y en cuánto tiempo.
  — Starter patrones: explica en exactamente 3 puntos qué
    observas (frecuencia de comportamiento, categorías de
    gasto, tendencias a lo largo del tiempo). Sin datos
    inventados — si no tienes datos aún, dilo y pide que
    empiece a compartir.
  — Starter información: lista exactamente qué necesitas
    (montos, categorías, fechas, recurrencia, metas) y
    qué NO necesitas jamás (nombre completo, documento
    de identidad, credenciales bancarias).

FEEDBACK NEGATIVO:
Si el usuario indica que una respuesta fue incorrecta o
incompleta, reconócelo sin exceso: 'Entendido, corrijo:'
seguido de la respuesta mejorada. Sin disculpas repetidas.`;

interface FeedbackSignal {
  id: string;
  message_id: string;
  thread_id: string;
  rating: "positive" | "negative";
  comment: string | null;
  is_first_session: boolean;
  created_at: string;
}

interface MessageRow {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  created_at: string;
}

/** Línea del dataset Alpaca para Unsloth. Orden de claves intencional. */
interface AlpacaRecord {
  instruction: string;
  input: string;
  output: string;
  rating: "positive" | "negative";
  is_first_session: boolean;
}

/** Resuelve la ruta de salida: --output <ruta> | --output=<ruta> | por defecto. */
function resolveOutputPath(argv: string[]): string {
  const eq = argv.find((a) => a.startsWith("--output="));
  if (eq) return eq.slice("--output=".length);
  const i = argv.indexOf("--output");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  // Timestamp compacto YYYYMMDD_HHMMSS en hora local.
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ts =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `exports/rlhf_${ts}.jsonl`;
}

async function main(): Promise<void> {
  const admin: SupabaseClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
realtime: { transport: ws as never },  
});

  const outputPath = resolveOutputPath(process.argv.slice(2));

  // 1) Lee todas las señales (orden temporal estable).
  const { data: signalsData, error: signalsErr } = await admin
    .from("feedback_signals")
    .select(
      "id, message_id, thread_id, rating, comment, is_first_session, created_at",
    )
    .order("created_at", { ascending: true });

  if (signalsErr) {
    console.error("Error leyendo feedback_signals:", signalsErr.message);
    process.exit(1);
  }
  const signals = (signalsData ?? []) as FeedbackSignal[];

  // Contadores para el resumen.
  let positives = 0;
  let negatives = 0;
  let firstSession = 0;
  let discarded = 0;
  const records: AlpacaRecord[] = [];

  // 2) Pre-carga los mensajes del asistente (los referenciados por message_id).
  const assistantById = new Map<string, MessageRow>();
  const messageIds = [...new Set(signals.map((s) => s.message_id))];
  for (let i = 0; i < messageIds.length; i += 100) {
    const batch = messageIds.slice(i, i + 100);
    const { data } = await admin
      .from("messages")
      .select("id, thread_id, role, content, created_at")
      .in("id", batch);
    for (const m of (data ?? []) as MessageRow[]) assistantById.set(m.id, m);
  }

  // 3) Por cada señal, empareja la respuesta del asistente con el mensaje de
  //    usuario inmediatamente anterior en el mismo hilo.
  for (const sig of signals) {
    if (sig.rating === "positive") positives++;
    else negatives++;
    if (sig.is_first_session) firstSession++;

    const assistant = assistantById.get(sig.message_id);
    if (!assistant || !assistant.content?.trim()) {
      discarded++; // señal huérfana: no existe la respuesta.
      continue;
    }

    const { data: userRows } = await admin
      .from("messages")
      .select("id, thread_id, role, content, created_at")
      .eq("thread_id", sig.thread_id)
      .eq("role", "user")
      .lt("created_at", assistant.created_at)
      .order("created_at", { ascending: false })
      .limit(1);

    const userMsg = (userRows ?? [])[0] as MessageRow | undefined;
    if (!userMsg || !userMsg.content?.trim()) {
      discarded++; // sin mensaje de usuario previo: par incompleto.
      continue;
    }

    // 4) En señales negativas con comentario, anota la corrección sugerida.
    let output = assistant.content;
    if (sig.rating === "negative" && sig.comment?.trim()) {
      output += `\n[CORRECCIÓN SUGERIDA: ${sig.comment.trim()}]`;
    }

    records.push({
      instruction: SYSTEM_PROMPT_BASE,
      input: userMsg.content,
      output,
      rating: sig.rating,
      is_first_session: sig.is_first_session,
    });
  }

  // 6) Escribe el JSONL (una línea por par). exports/ está en .gitignore.
  if (records.length > 0) {
    mkdirSync(dirname(outputPath), { recursive: true });
    const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    writeFileSync(outputPath, jsonl, "utf-8");
  }

  // 7) Resumen (números fríos — ver docs/RLHF_PIPELINE.md para interpretarlos).
  const exportedFirstSession = records.filter((r) => r.is_first_session).length;
  console.log("\n── Exportación RLHF ────────────────────────────────");
  console.log(`Total señales procesadas : ${signals.length}`);
  console.log(`  Positivas              : ${positives}`);
  console.log(`  Negativas              : ${negatives}`);
  console.log(
    `Primera sesión (peso x3) : ${firstSession}` +
      ` (exportadas: ${exportedFirstSession})`,
  );
  console.log(`Pares exportados         : ${records.length}`);
  console.log(`Descartados (huérfanos)  : ${discarded}`);
  if (records.length > 0) {
    console.log(`\nDataset escrito en: ${outputPath}`);
  } else {
    console.log("\nNada que exportar: no se escribió ningún archivo.");
  }
  console.log("────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("\n✗ export-rlhf falló:", err);
  process.exit(1);
});
