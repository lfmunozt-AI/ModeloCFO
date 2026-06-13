// Utilidades puras del dominio, sin dependencias de runtime (testeable en aislamiento).

const TITLE_MAX_WORDS = 6;
const TITLE_MAX_CHARS = 40;

/**
 * Deriva el título de un hilo a partir de su primer mensaje: toma las ~6
 * primeras palabras y recorta a 40 caracteres como máximo. Colapsa espacios
 * en blanco múltiples (split por /\s+/).
 */
export function deriveTitle(message: string): string {
  const words = message.trim().split(/\s+/).slice(0, TITLE_MAX_WORDS).join(" ");
  return words.length > TITLE_MAX_CHARS
    ? words.slice(0, TITLE_MAX_CHARS).trimEnd()
    : words;
}
