import { defineConfig, configDefaults } from "vitest/config";

// Cada suite corre con su propio runner:
//   - vitest     → tests del resto del proyecto (p. ej. AG07).
//   - node:test  → guardarraíl (lib/guardrail/**), vía `npm run test:guardrail`.
//
// El guardarraíl está escrito con el runner nativo `node:test`, que vitest no
// sabe interpretar; por eso se excluye aquí. `passWithNoTests` evita que
// `vitest run` falle cuando todavía no hay tests de vitest en la rama (los del
// guardarraíl los ejecuta node:test en el segundo tramo del script `test`).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "lib/guardrail/**"],
    passWithNoTests: true,
  },
});
