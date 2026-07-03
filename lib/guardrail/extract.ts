// PIEZA 1 — Extractor de cifras de entrada.
//
// Recibe el mensaje del usuario y devuelve los "hechos verificados": las cifras
// que el usuario SÍ aportó, con su etiqueta y moneda. Es la fuente de verdad
// contra la que la Pieza 2 valida lo que dice el modelo.
//
// Código PURO (regex + lógica), edge-safe, SIN llamadas a ningún LLM (~ms).

import { findNumberMentions, dedupeOverlaps, type NumberMention } from "./numbers";
import { detectCurrency, detectLabel, isTimeUnit, type Moneda } from "./context";

// Contextos NO monetarios: la cifra cuantifica personas/veces/edad, no dinero.
// "dos hijos", "3 personas", "2 veces", "30 años de edad" no son hechos-cifra.
// La palabra debe seguir directamente a la cifra (ventana corta).
const NON_MONETARY_AFTER =
  /^\s*(?:hijos?|hijas?|personas?|veces|vez|anos?\s+de\s+edad)\b/;

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** ¿La cifra cuantifica algo NO monetario (personas, veces, edad)? */
function isNonMonetaryQuantity(text: string, m: NumberMention): boolean {
  return NON_MONETARY_AFTER.test(stripAccents(text.slice(m.end, m.end + 20)));
}

/** Un hecho verificado aportado por el usuario. */
export interface VerifiedFact {
  /** Valor numérico (normalizado a number). */
  valor: number;
  /** A qué se refiere ("deuda", "ingreso"…) o "" si no hay contexto claro. */
  etiqueta: string;
  /** Moneda/contexto detectado (EUR, pesos, %, $…) o null. */
  moneda: Moneda;
}

/**
 * Extrae los hechos verificados del mensaje del usuario.
 *
 * - Detecta montos en dígitos (40000, 1.200,50) y en palabras (mil, millones).
 * - Detecta la moneda/contexto si está presente (euros, pesos, %).
 * - Asocia cada cifra a su etiqueta por proximidad ("40000 en deudas" → deuda).
 * - Si no hay cifras, devuelve [] (caso "sin contexto").
 *
 * Las duraciones temporales ("3 meses") NO son hechos monetarios y se omiten.
 */
export function extractInputFacts(message: string): VerifiedFact[] {
  if (!message || !message.trim()) return [];

  const mentions = dedupeOverlaps(findNumberMentions(message));
  const facts: VerifiedFact[] = [];

  for (const m of mentions) {
    // Una duración ("contrato a 12 meses") no es un monto: no es un "hecho cifra".
    if (isTimeUnit(message, m)) continue;
    // Una cantidad no monetaria ("dos hijos", "30 años de edad") tampoco lo es.
    if (isNonMonetaryQuantity(message, m)) continue;

    facts.push({
      valor: m.value,
      etiqueta: detectLabel(message, m),
      moneda: detectCurrency(message, m),
    });
  }

  return facts;
}
