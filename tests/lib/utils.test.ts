import { describe, it, expect } from "vitest";
import { deriveTitle } from "@/lib/utils";

describe("deriveTitle", () => {
  it("toma como máximo las 6 primeras palabras", () => {
    const out = deriveTitle("uno dos tres cuatro cinco seis siete ocho");
    expect(out).toBe("uno dos tres cuatro cinco seis");
  });

  it("respeta mensajes con menos de 6 palabras", () => {
    expect(deriveTitle("balance trimestral")).toBe("balance trimestral");
  });

  it("colapsa espacios en blanco múltiples (tabs, saltos, espacios)", () => {
    expect(deriveTitle("  hola   \t  mundo \n cruel  ")).toBe("hola mundo cruel");
  });

  it("recorta a 40 caracteres como máximo", () => {
    // 6 palabras de 8 chars = 48 chars + 5 espacios = 53 chars antes del corte.
    const msg = "aaaaaaaa bbbbbbbb cccccccc dddddddd eeeeeeee ffffffff";
    const out = deriveTitle(msg);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).toBe("aaaaaaaa bbbbbbbb cccccccc dddddddd eeee");
  });

  it("hace trimEnd tras recortar (sin espacio colgante al final)", () => {
    // El corte a 40 cae justo en un espacio → debe quedar limpio.
    // "aaaa..." de modo que el char 40 sea un espacio.
    const msg = "aaaaaaaaa bbbbbbbbb ccccccccc ddddddddd eeeeeeeee";
    const out = deriveTitle(msg);
    expect(out).toBe(out.trimEnd());
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it("devuelve cadena vacía con entrada vacía", () => {
    expect(deriveTitle("")).toBe("");
    expect(deriveTitle("    ")).toBe("");
  });
});
