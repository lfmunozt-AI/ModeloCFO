// PIEZA 2 — Validador de grounding de salida.
//
// Recibe la respuesta del modelo y los hechos verificados (Pieza 1) y decide,
// para cada cifra monetaria de la respuesta, si está "fundamentada" (grounded):
//
//   a) APROBADA si coincide con un hecho verificado del usuario.
//   b) APROBADA si es un porcentaje o una regla general (20%, "3 a 6 meses"):
//      son conceptos, no montos inventados.
//   c) APROBADA si se deriva de un cálculo sobre un hecho (10000 → "ahorra
//      2000" = 20% de 10000).
//   d) BLOQUEADA si es un monto absoluto que no viene del usuario ni de cálculo.
//
// Código PURO (regex + aritmética), edge-safe, SIN llamadas a ningún LLM.

import { findNumberMentions, dedupeOverlaps, type NumberMention } from "./numbers";
import { detectCurrency, isPercent, isTimeUnit, type Moneda } from "./context";
import type { VerifiedFact } from "./extract";

/** Por qué se aprobó una cifra. */
export type Categoria = "hecho" | "concepto" | "calculo";

export interface ApprovedFigure {
  valor: number;
  texto: string;
  moneda: Moneda;
  categoria: Categoria;
  motivo: string;
}

export interface BlockedFigure {
  valor: number;
  texto: string;
  moneda: Moneda;
  motivo: string;
  /** Posición en la respuesta — la Pieza 3 la usa para reescribir la frase. */
  start: number;
  end: number;
}

export interface GroundingResult {
  cifras_aprobadas: ApprovedFigure[];
  cifras_bloqueadas: BlockedFigure[];
}

// Tolerancia de comparación: 1% relativo con un piso absoluto de 1 (redondeos).
function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);
}

// Multiplicadores "limpios" que cuentan como derivación de un hecho: fracciones
// y porcentajes habituales + conversiones mensual/anual (×12, /12, trimestres…).
const COMMON_MULTIPLIERS = [
  0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 1 / 3, 0.4, 0.5, 0.6, 2 / 3, 0.7, 0.75, 0.8,
  0.9, 1 / 12, 1 / 6, 1 / 4, 1 / 2, 2, 3, 4, 5, 6, 10, 12,
];

/**
 * ¿La cifra `v` se deriva por un cálculo simple sobre los hechos del usuario?
 * Considera: múltiplos/fracciones limpias de un hecho, los porcentajes que la
 * propia respuesta menciona aplicados a un hecho, y sumas/restas de pares.
 */
function isDerived(
  v: number,
  facts: VerifiedFact[],
  explicitPercents: number[],
): boolean {
  const values = facts.map((f) => f.valor).filter((x) => Number.isFinite(x));
  const multipliers = [
    ...COMMON_MULTIPLIERS,
    ...explicitPercents.map((p) => p / 100),
  ];

  for (const f of values) {
    if (f === 0) continue;
    for (const p of multipliers) {
      if (approxEqual(v, f * p)) return true;
    }
  }

  // Combinaciones de hechos (p. ej. total de deudas, ingreso neto).
  if (values.length >= 2) {
    const total = values.reduce((a, b) => a + b, 0);
    if (approxEqual(v, total)) return true;
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        if (approxEqual(v, values[i] + values[j])) return true;
        if (approxEqual(v, Math.abs(values[i] - values[j]))) return true;
      }
    }
  }

  return false;
}

/** Coincidencia EXACTA con una cifra del motor (±0.01), no la tolerancia del 1%. */
function exactMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.01;
}

// Marcadores condicionales/ilustrativos: cuando preceden a una cifra en su misma
// frase, la cifra es un ejemplo hipotético, no un monto real. "si" se casa con
// límite de palabra y SIN normalizar acentos, para no confundir "sí" (afirmación)
// con "si" (condicional).
const HYPOTHETICAL_MARKERS = [
  /\bsi\b/,
  /\bpor ejemplo\b/,
  /\bsupongamos\b/,
  /\bimagina que\b/,
  /\bpongamos que\b/,
  /\bdigamos que\b/,
];

/** Trozo de la MISMA oración que precede a la cifra (corta en . ! ? ; y salto). */
function sentencePrefixBefore(text: string, start: number): string {
  const before = text.slice(0, start);
  const boundary = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf(";"),
    before.lastIndexOf("\n"),
  );
  return before.slice(boundary + 1);
}

/** ¿La cifra va precedida por un marcador hipotético en su misma oración? */
function hasHypotheticalMarker(text: string, m: NumberMention): boolean {
  const prefix = sentencePrefixBefore(text, m.start).toLowerCase();
  return HYPOTHETICAL_MARKERS.some((re) => re.test(prefix));
}

/**
 * ¿`v` coincide (±0.01) con alguna operación aritmética entre `a` y `b`?
 * Cubre suma, resta (valor absoluto), producto y ambos cocientes (con
 * denominador ≠ 0). Es la unidad del cierre del paquete sobre un par de
 * operandos.
 */
function combines(v: number, a: number, b: number): boolean {
  if (exactMatch(v, a + b)) return true;
  if (exactMatch(v, Math.abs(a - b))) return true;
  if (exactMatch(v, a * b)) return true;
  if (b !== 0 && exactMatch(v, a / b)) return true;
  if (a !== 0 && exactMatch(v, b / a)) return true;
  return false;
}

/**
 * CIERRE ARITMÉTICO DEL PAQUETE. Con el motor financiero presente, una cifra `v`
 * cuenta como cálculo verificado si coincide (±0.01) con una operación
 * (suma, resta, producto o cociente) entre:
 *   - dos cifras calculadas, o
 *   - una calculada y un hecho del usuario.
 * La coincidencia directa con una cifra calculada se comprueba aparte
 * (exactMatch); aquí solo se cubren las combinaciones de dos operandos.
 */
function matchesPackageClosure(
  v: number,
  cifrasCalculadas: number[],
  facts: VerifiedFact[],
): boolean {
  // Operaciones entre DOS cifras calculadas.
  for (let i = 0; i < cifrasCalculadas.length; i++) {
    for (let j = i + 1; j < cifrasCalculadas.length; j++) {
      if (combines(v, cifrasCalculadas[i], cifrasCalculadas[j])) return true;
    }
  }
  // Operaciones entre una calculada y un hecho del usuario.
  const factValues = facts.map((f) => f.valor).filter((x) => Number.isFinite(x));
  for (const c of cifrasCalculadas) {
    for (const f of factValues) {
      if (combines(v, c, f)) return true;
    }
  }
  return false;
}

/**
 * Valida el grounding de todas las cifras de la respuesta del modelo contra los
 * hechos verificados del usuario.
 *
 * `cifrasCalculadas` (opcional) son los resultados EXACTOS del motor financiero
 * (lib/calculator). CUANDO EL PAQUETE ESTÁ PRESENTE (length > 0) el motor manda:
 * una cifra se aprueba como "calculo" si coincide exactamente (±0.01) con una
 * calculada o con el CIERRE ARITMÉTICO del paquete (suma/resta de dos calculadas
 * o de una calculada y un hecho); NO se aplican los multiplicadores heurísticos
 * sobre los hechos. CUANDO EL PAQUETE ESTÁ VACÍO, la heurística de derivación
 * (COMMON_MULTIPLIERS + sumas de pares) sigue intacta como red de respaldo.
 * El parámetro es opcional para no romper la firma ni los tests existentes.
 */
export function validateGrounding(
  modelResponse: string,
  facts: VerifiedFact[],
  cifrasCalculadas: number[] = [],
): GroundingResult {
  const aprobadas: ApprovedFigure[] = [];
  const bloqueadas: BlockedFigure[] = [];

  if (!modelResponse || !modelResponse.trim()) {
    return { cifras_aprobadas: aprobadas, cifras_bloqueadas: bloqueadas };
  }

  const figs = dedupeOverlaps(findNumberMentions(modelResponse));

  // Porcentajes que la respuesta menciona explícitamente (señal de cálculo).
  const explicitPercents = figs
    .filter((m) => isPercent(modelResponse, m))
    .map((m) => m.value);

  const factValues = facts.map((f) => f.valor);

  // Con paquete del motor (cifras calculadas presentes), la heurística de
  // multiplicadores se desactiva: manda el motor (punto 2 de la calibración).
  const usarMotor = cifrasCalculadas.length > 0;

  // Los hipotéticos ilustrativos solo aplican si el usuario NO aportó hechos que
  // contradigan: sin datos reales, una cifra con marcador es un ejemplo.
  const sinHechos = facts.length === 0;

  for (const m of figs) {
    const moneda = detectCurrency(modelResponse, m);

    // (b) Porcentaje → concepto, se mantiene.
    if (isPercent(modelResponse, m)) {
      aprobadas.push({ ...base(m, moneda), categoria: "concepto", motivo: "porcentaje" });
      continue;
    }
    // (b) Regla general temporal ("3 a 6 meses") → concepto, se mantiene.
    if (isTimeUnit(modelResponse, m)) {
      aprobadas.push({ ...base(m, moneda), categoria: "concepto", motivo: "regla temporal" });
      continue;
    }
    // (a) Coincide con un hecho verificado.
    if (factValues.some((f) => approxEqual(m.value, f))) {
      aprobadas.push({ ...base(m, moneda), categoria: "hecho", motivo: "dato del usuario" });
      continue;
    }
    if (usarMotor) {
      // (c0) Coincide EXACTAMENTE con una cifra del motor financiero. Se prueba
      // ANTES de cualquier heurística: si el código ya calculó esta cifra, es
      // cálculo verificado, no una coincidencia aproximada.
      if (cifrasCalculadas.some((c) => exactMatch(m.value, c))) {
        aprobadas.push({ ...base(m, moneda), categoria: "calculo", motivo: "cálculo verificado por el motor financiero" });
        continue;
      }
      // (c1) Cierre aritmético del paquete: suma/resta de dos calculadas, o de
      // una calculada y un hecho del usuario.
      if (matchesPackageClosure(m.value, cifrasCalculadas, facts)) {
        aprobadas.push({ ...base(m, moneda), categoria: "calculo", motivo: "cierre aritmético del paquete del motor" });
        continue;
      }
      // Con motor presente NO se aplican multiplicadores heurísticos: el motor
      // manda. Cualquier cifra que no case cae al bloqueo (d).
    } else {
      // (c) Sin motor: red de respaldo heurística — derivación por cálculo simple
      // sobre un hecho (múltiplos/fracciones limpias, sumas/restas de pares).
      if (isDerived(m.value, facts, explicitPercents)) {
        aprobadas.push({ ...base(m, moneda), categoria: "calculo", motivo: "cálculo sobre un dato del usuario" });
        continue;
      }
    }
    // (b') Hipotético ilustrativo: cifra precedida por un marcador condicional
    // ("si", "por ejemplo", "supongamos"…) en su misma frase y SIN hechos del
    // usuario que contradigan → es un ejemplo, no un monto real. Se aprueba como
    // concepto ANTES del bloqueo (decisión de producto aprobada).
    if (sinHechos && hasHypotheticalMarker(modelResponse, m)) {
      aprobadas.push({ ...base(m, moneda), categoria: "concepto", motivo: "hipotético ilustrativo" });
      continue;
    }
    // (d) Monto absoluto sin respaldo → se bloquea.
    bloqueadas.push({
      ...base(m, moneda),
      motivo: "monto sin respaldo en los datos del usuario",
      start: m.start,
      end: m.end,
    });
  }

  return { cifras_aprobadas: aprobadas, cifras_bloqueadas: bloqueadas };
}

function base(m: NumberMention, moneda: Moneda) {
  return { valor: m.value, texto: m.text, moneda };
}
