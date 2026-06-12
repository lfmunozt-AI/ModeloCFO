/**
 * Seed de datos sintéticos para desarrollo local (AG02).
 *
 * Crea 2 usuarios de prueba, cada uno con 1 hilo y 1 documento. Sirve para
 * verificar el aislamiento multitenant del RAG: ningún usuario debe recuperar
 * los chunks del otro (ver docs/control/AG02_RESUMEN.md → verificación).
 *
 * Requiere `SUPABASE_SERVICE_ROLE_KEY` (bypasea RLS) — SOLO en local. Nunca se
 * commitea su valor; se lee del entorno.
 *
 * Uso:
 *   export NEXT_PUBLIC_SUPABASE_URL=...        # o usa .env.local cargado por tu shell
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx tsx scripts/seed.ts
 *
 * Idempotente: si un usuario ya existe, reutiliza su id en vez de fallar.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.\n" +
      "Este script es SOLO para uso local. Aborto.",
  );
  process.exit(1);
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface SeedUser {
  email: string;
  password: string;
  threadTitle: string;
  docName: string;
  docContent: string;
}

const USERS: SeedUser[] = [
  {
    email: "tester1@test.local",
    password: "tester1-local-pw",
    threadTitle: "Planificación financiera",
    docName: "notas-tester1.md",
    docContent:
      "# Notas de Tester 1\n\nFondo de emergencia objetivo: 12.000 EUR.\n" +
      "Aportación mensual a inversión: 400 EUR en un fondo indexado global.\n" +
      "Hipoteca pendiente: 95.000 EUR al 2,1% TIN.",
  },
  {
    email: "tester2@test.local",
    password: "tester2-local-pw",
    threadTitle: "Revisión de gastos",
    docName: "notas-tester2.md",
    docContent:
      "# Notas de Tester 2\n\nIngreso mensual neto: 2.300 EUR como autónomo.\n" +
      "Suscripciones a revisar: 3 servicios de streaming sumando 38 EUR/mes.\n" +
      "Meta: ahorrar 6 meses de gastos antes de fin de año.",
  },
];

/** Crea el usuario o devuelve el id si ya existe. */
async function ensureUser(u: SeedUser): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
  });

  if (!error && data.user) {
    console.log(`  · usuario creado: ${u.email} (${data.user.id})`);
    return data.user.id;
  }

  // Ya existe: lo buscamos por email paginando la lista de usuarios.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw listErr;
  const existing = list.users.find((x) => x.email === u.email);
  if (!existing) {
    throw error ?? new Error(`No se pudo crear ni encontrar ${u.email}`);
  }
  console.log(`  · usuario ya existía: ${u.email} (${existing.id})`);
  return existing.id;
}

async function seedUser(u: SeedUser): Promise<void> {
  console.log(`\n▶ ${u.email}`);
  const userId = await ensureUser(u);

  // Hilo.
  const { error: threadErr } = await admin
    .from("threads")
    .insert({ user_id: userId, title: u.threadTitle });
  if (threadErr) throw threadErr;
  console.log(`  · hilo: "${u.threadTitle}"`);

  // Documento (status 'ready'; la ingesta de chunks se hace vía /api/documents
  // con un JWT de usuario real — aquí solo dejamos el documento listo).
  const { error: docErr } = await admin.from("documents").insert({
    user_id: userId,
    name: u.docName,
    content: u.docContent,
    status: "ready",
  });
  if (docErr) throw docErr;
  console.log(`  · documento: "${u.docName}"`);
}

async function main(): Promise<void> {
  console.log("Seed de ModeloCFO (datos sintéticos locales)…");
  for (const u of USERS) {
    await seedUser(u);
  }
  console.log("\n✓ Seed completado.");
}

main().catch((err) => {
  console.error("\n✗ Seed falló:", err);
  process.exit(1);
});
