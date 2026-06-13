import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests del backend: funciones puras (lib/) y handlers de ruta con Supabase
// mockeado. Entorno node (no necesitamos DOM); el alias "@/" replica el de
// tsconfig para que los imports de producción resuelvan igual que en Next.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
