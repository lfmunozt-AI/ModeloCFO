import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests del backend con vitest: funciones puras (lib/) y handlers de ruta.
// El guardarraíl (lib/guardrail/**) usa node:test, no vitest — se excluye
// explícitamente y se corre con `npm run test:guardrail`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "lib/guardrail/**"],
    globals: false,
    passWithNoTests: true,
  },
});
