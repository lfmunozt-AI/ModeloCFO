// Tests de la ampliación del parser numérico: espacio como separador de miles
// ("2 500") y sufijo "k" ("2,5k"). Runner nativo de Node (node:test) vía tsx.
// Ejecutar: `npm test`. NO debe romper las convenciones existentes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDigitAmount, findNumberMentions } from "./numbers";

test("numbers: espacio como separador de miles '2 500' → 2500", () => {
  assert.equal(parseDigitAmount("2 500"), 2500);
  const vals = findNumberMentions("tengo 2 500 pesos").map((m) => m.value);
  assert.ok(vals.includes(2500), `esperaba 2500 en ${JSON.stringify(vals)}`);
});

test("numbers: espacio de miles con más grupos '1 200 000' → 1200000", () => {
  const vals = findNumberMentions("ahorré 1 200 000 el año pasado").map((m) => m.value);
  assert.ok(vals.includes(1200000), `esperaba 1200000 en ${JSON.stringify(vals)}`);
});

test("numbers: sufijo k '2,5k' → 2500", () => {
  const vals = findNumberMentions("ahorro 2,5k al mes").map((m) => m.value);
  assert.ok(vals.includes(2500), `esperaba 2500 en ${JSON.stringify(vals)}`);
});

test("numbers: sufijo k entero '3k' → 3000", () => {
  const vals = findNumberMentions("gano 3k").map((m) => m.value);
  assert.ok(vals.includes(3000), `esperaba 3000 en ${JSON.stringify(vals)}`);
});

test("numbers: NO rompe convención es/LatAm existente", () => {
  assert.equal(parseDigitAmount("40000"), 40000);
  assert.equal(parseDigitAmount("1.200"), 1200);
  assert.equal(parseDigitAmount("1.200,50"), 1200.5);
  assert.equal(parseDigitAmount("1.200.000"), 1200000);
  assert.deepEqual(findNumberMentions("tengo 40000").map((m) => m.value), [40000]);
});

test("numbers: 'k' pegada a otra letra NO se interpreta como miles ('2kg')", () => {
  const vals = findNumberMentions("compré 2kg de café").map((m) => m.value);
  assert.ok(vals.includes(2), `esperaba 2 en ${JSON.stringify(vals)}`);
  assert.ok(!vals.includes(2000), "no debe convertir 2kg en 2000");
});

test("numbers (02d): marcadores de lista markdown se ignoran ('1. Ahorro\\n2. Ocio')", () => {
  const vals = findNumberMentions("1. Ahorro\n2. Ocio").map((m) => m.value);
  assert.deepEqual(vals, [], `esperaba cero menciones, obtuve ${JSON.stringify(vals)}`);
});

test("numbers (02d): marcador con ')' también se ignora, pero cifras reales no", () => {
  const vals = findNumberMentions("1) Deuda de 40000\n2) Meta").map((m) => m.value);
  assert.ok(vals.includes(40000), "la cifra real 40000 se conserva");
  assert.ok(!vals.includes(1) && !vals.includes(2), "los ordinales de lista no cuentan");
});

test("numbers (02d): un '1.200' de miles NO se confunde con marcador de lista", () => {
  const vals = findNumberMentions("1.200 en total").map((m) => m.value);
  assert.deepEqual(vals, [1200], `esperaba [1200], obtuve ${JSON.stringify(vals)}`);
});
