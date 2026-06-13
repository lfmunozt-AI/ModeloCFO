/**
 * Auditoría de aislamiento cross-tenant de ModeloCFO (AG03 — seguridad).
 *
 * Crea DOS usuarios de prueba con service role en local, siembra datos del
 * usuario A en TODAS las tablas multitenant, y luego —actuando como el usuario
 * B— intenta acceder a los datos de A por cada vía de la aplicación. El
 * resultado esperado es 0 filas / 0 escrituras / 0 éxitos en cada vector: la RLS
 * (SECURITY INVOKER + filtro por auth.uid()) y los route handlers deben bloquear
 * todo acceso cruzado.
 *
 * Vectores probados (con el JWT/cookies de B contra los datos de A):
 *   1. SELECT threads de A           (REST anon key)         → 0 filas
 *   2. SELECT messages de A          (REST anon key)         → 0 filas
 *   3. SELECT documents de A         (REST anon key)         → 0 filas
 *   4. SELECT document_chunks de A   (REST anon key)         → 0 filas
 *   5. SELECT memory_chunks de A     (REST anon key)         → 0 filas
 *   6. RPC match_context             (REST anon key)         → 0 fugas de A
 *   7. UPDATE thread de A            (REST anon key)         → 0 filas afectadas
 *   8. DELETE thread de A            (REST anon key)         → 0 filas afectadas
 *   9. PATCH /api/threads/[idA]      (route, cookies de B)   → 404, A intacto
 *  10. DELETE /api/threads/[idA]     (route, cookies de B)   → 404, A intacto
 *  11. PATCH /api/threads/[inexistente] (route, cookies B)   → 404 (no 500)
 *
 * Los vectores 9–11 requieren el servidor de desarrollo en marcha (`npm run dev`);
 * si no es alcanzable se marcan SKIPPED (los vectores 7–8 ya prueban el bloqueo
 * de escritura cruzada a nivel de RLS).
 *
 * Requiere `SUPABASE_SERVICE_ROLE_KEY` (bypasea RLS) — SOLO en local. Nunca se
 * commitea su valor; se lee del entorno.
 *
 * Uso:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...        # solo local
 *   # (opcional) export SECURITY_CHECK_BASE_URL=http://localhost:3000
 *   npm run dev            # en otra terminal, para los vectores 9–11
 *   npx tsx scripts/security-check.ts
 *
 * Salida: tabla de resultados por vector + resumen. Código de salida 1 si hay
 * cualquier FUGA (FAIL); 0 si todo PASS (los SKIPPED no fallan la auditoría).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// ── Entorno ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL =
  process.env.SECURITY_CHECK_BASE_URL ?? "http://localhost:3000";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error(
    "Faltan variables de entorno requeridas:\n" +
      "  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY\n" +
      "Este script es SOLO para uso local. Aborto.",
  );
  process.exit(1);
}

// Cliente con service role: SOLO para crear usuarios y sembrar datos. Bypasea
// RLS — jamás se usa para simular el acceso del atacante.
const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Usuarios de prueba ───────────────────────────────────────────────────────
const USER_A = { email: "sec-check-a@test.local", password: "sec-check-a-pw" };
const USER_B = { email: "sec-check-b@test.local", password: "sec-check-b-pw" };

// Marcador único de los datos de A: si aparece en cualquier respuesta a B, fuga.
const MARKER = `SECRET_A_${Date.now()}`;

/** Vector 384-dim determinista (gte-small). El valor concreto es irrelevante
 *  para el aislamiento; usamos el MISMO para el chunk de A y para la consulta de
 *  match_context (coseno = 1) para que, si la RLS fallara, el chunk de A saliera
 *  el primero — el test más exigente posible. */
const EMBEDDING: number[] = Array.from({ length: 384 }, (_, i) =>
  Math.sin(i + 1),
);

// ── Helpers ──────────────────────────────────────────────────────────────────
interface Result {
  n: number;
  vector: string;
  expected: string;
  observed: string;
  status: "PASS" | "FAIL" | "SKIP";
}
const results: Result[] = [];

function record(
  n: number,
  vector: string,
  expected: string,
  observed: string,
  pass: boolean | "skip",
): void {
  results.push({
    n,
    vector,
    expected,
    observed,
    status: pass === "skip" ? "SKIP" : pass ? "PASS" : "FAIL",
  });
}

/** Crea el usuario o devuelve su id si ya existe (paginando como en seed.ts). */
async function ensureUser(u: {
  email: string;
  password: string;
}): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
  });
  if (!error && data.user) return data.user.id;

  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw listErr;
  const existing = list.users.find((x) => x.email === u.email);
  if (!existing) throw error ?? new Error(`No se pudo crear/encontrar ${u.email}`);
  return existing.id;
}

/** Borra todos los datos de un usuario (idempotencia entre ejecuciones).
 *  Borrar documents/threads arrastra chunks/messages/memoria por ON DELETE CASCADE. */
async function wipeUserData(userId: string): Promise<void> {
  await admin.from("documents").delete().eq("user_id", userId);
  await admin.from("threads").delete().eq("user_id", userId);
}

interface SeededA {
  userId: string;
  threadId: string;
  docId: string;
}

/** Siembra datos de A en todas las tablas multitenant, con el marcador único. */
async function seedUserA(userId: string): Promise<SeededA> {
  const { data: thread, error: tErr } = await admin
    .from("threads")
    .insert({ user_id: userId, title: `hilo de A ${MARKER}` })
    .select("id")
    .single();
  if (tErr || !thread) throw tErr ?? new Error("No se sembró el hilo de A");
  const threadId = thread.id as string;

  const { error: mErr } = await admin.from("messages").insert({
    thread_id: threadId,
    role: "user",
    content: `mensaje privado de A ${MARKER}`,
  });
  if (mErr) throw mErr;

  const { data: doc, error: dErr } = await admin
    .from("documents")
    .insert({
      user_id: userId,
      name: `doc-de-A-${MARKER}.md`,
      content: `contenido confidencial ${MARKER}`,
      status: "ready",
    })
    .select("id")
    .single();
  if (dErr || !doc) throw dErr ?? new Error("No se sembró el documento de A");
  const docId = doc.id as string;

  const { error: dcErr } = await admin.from("document_chunks").insert({
    document_id: docId,
    user_id: userId,
    chunk_index: 0,
    content: `chunk confidencial ${MARKER}`,
    embedding: EMBEDDING,
  });
  if (dcErr) throw dcErr;

  const { error: mcErr } = await admin.from("memory_chunks").insert({
    user_id: userId,
    thread_id: threadId,
    content: `recuerdo confidencial ${MARKER}`,
    embedding: EMBEDDING,
  });
  if (mcErr) throw mcErr;

  return { userId, threadId, docId };
}

/** Cliente anon autenticado como B (REST/RPC con su JWT). */
async function signInAnon(u: {
  email: string;
  password: string;
}): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: u.email,
    password: u.password,
  });
  if (error) throw error;
  return client;
}

/** Construye la cabecera Cookie de B replicando EXACTAMENTE el formato chunked de
 *  @supabase/ssr: firmamos a B con un cliente servidor de jar en memoria y
 *  capturamos las cookies que el navegador habría guardado. Robusto a versiones. */
async function buildSessionCookieHeader(u: {
  email: string;
  password: string;
}): Promise<string> {
  const jar = new Map<string, string>();
  const ssr = createServerClient(SUPABASE_URL!, ANON_KEY!, {
    cookies: {
      getAll: () =>
        [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { error } = await ssr.auth.signInWithPassword({
    email: u.email,
    password: u.password,
  });
  if (error) throw error;
  // base64url + el prefijo `base64-` no contienen caracteres especiales de
  // cookie, así que se envían tal cual.
  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

/** ¿Está el servidor de desarrollo accesible? (para los vectores de ruta). */
async function serverReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${BASE_URL}/login`, {
      method: "GET",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.status < 500;
  } catch {
    return false;
  }
}

// ── Auditoría ────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("══════════════════════════════════════════════════════════════");
  console.log(" ModeloCFO — Auditoría de aislamiento cross-tenant (AG03)");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log(`  Servidor app: ${BASE_URL}`);
  console.log(`  Marcador de datos de A: ${MARKER}\n`);

  // Preparación (service role).
  console.log("▶ Preparando usuarios y datos de A (service role)…");
  const userAId = await ensureUser(USER_A);
  const userBId = await ensureUser(USER_B);
  if (userAId === userBId) throw new Error("A y B no pueden ser el mismo usuario");
  await wipeUserData(userAId);
  await wipeUserData(userBId);
  const a = await seedUserA(userAId);
  console.log(`  · A=${userAId}  thread=${a.threadId}  doc=${a.docId}`);
  console.log(`  · B=${userBId}\n`);

  // Sesión de B.
  console.log("▶ Autenticando como usuario B (anon key)…\n");
  const b = await signInAnon(USER_B);

  // ── Vectores 1–5: lectura cruzada vía REST (anon key, JWT de B) ──────────────
  // Cada SELECT apunta explícitamente a filas de A; la RLS de B debe devolver 0.
  // Un error de RLS también es "sin acceso"; lo que NUNCA debe pasar es leer filas.
  const reads: { n: number; vector: string; rows: number; err?: string }[] = [];
  {
    const { data, error } = await b
      .from("threads")
      .select("id")
      .eq("user_id", a.userId);
    reads.push({ n: 1, vector: "SELECT threads de A", rows: data?.length ?? 0, err: error?.code ?? error?.message });
  }
  {
    const { data, error } = await b
      .from("messages")
      .select("id")
      .eq("thread_id", a.threadId);
    reads.push({ n: 2, vector: "SELECT messages de A", rows: data?.length ?? 0, err: error?.code ?? error?.message });
  }
  {
    const { data, error } = await b
      .from("documents")
      .select("id")
      .eq("user_id", a.userId);
    reads.push({ n: 3, vector: "SELECT documents de A", rows: data?.length ?? 0, err: error?.code ?? error?.message });
  }
  {
    const { data, error } = await b
      .from("document_chunks")
      .select("id")
      .eq("user_id", a.userId);
    reads.push({ n: 4, vector: "SELECT document_chunks de A", rows: data?.length ?? 0, err: error?.code ?? error?.message });
  }
  {
    const { data, error } = await b
      .from("memory_chunks")
      .select("id")
      .eq("user_id", a.userId);
    reads.push({ n: 5, vector: "SELECT memory_chunks de A", rows: data?.length ?? 0, err: error?.code ?? error?.message });
  }
  for (const r of reads) {
    record(
      r.n,
      r.vector,
      "0 filas",
      r.err ? `error RLS: ${r.err}` : `${r.rows} filas`,
      r.rows === 0,
    );
  }

  // ── Vector 6: match_context como B no debe devolver datos de A ───────────────
  {
    const { data, error } = await b.rpc("match_context", {
      query_embedding: EMBEDDING,
      match_count: 10,
    });
    const leaked =
      (data ?? []).filter(
        (row: { content?: string; source?: string }) =>
          (row.content ?? "").includes(MARKER) ||
          (row.source ?? "").includes(MARKER),
      ).length;
    record(
      6,
      "RPC match_context",
      "0 filas con el marcador de A",
      error
        ? `error: ${error.code ?? error.message}`
        : `${data?.length ?? 0} filas, ${leaked} con marcador de A`,
      !error && leaked === 0,
    );
  }

  // ── Vectores 7–8: escritura cruzada vía REST (debe afectar 0 filas) ──────────
  {
    const { data, error } = await b
      .from("threads")
      .update({ title: "HACKEADO POR B" })
      .eq("id", a.threadId)
      .select("id");
    const affected = data?.length ?? 0;
    record(
      7,
      "UPDATE thread de A (REST)",
      "0 filas afectadas",
      error ? `error RLS: ${error.code ?? error.message}` : `${affected} filas`,
      affected === 0,
    );
  }
  {
    const { data, error } = await b
      .from("threads")
      .delete()
      .eq("id", a.threadId)
      .select("id");
    const affected = data?.length ?? 0;
    record(
      8,
      "DELETE thread de A (REST)",
      "0 filas afectadas",
      error ? `error RLS: ${error.code ?? error.message}` : `${affected} filas`,
      affected === 0,
    );
  }

  // ── Vectores 9–11: route handlers con las cookies de sesión de B ─────────────
  const up = await serverReachable();
  if (!up) {
    for (const [n, v] of [
      [9, "PATCH /api/threads/[idA] (cookies B)"],
      [10, "DELETE /api/threads/[idA] (cookies B)"],
      [11, "PATCH /api/threads/[inexistente] (cookies B)"],
    ] as const) {
      record(n, v, "404", `servidor no accesible en ${BASE_URL}`, "skip");
    }
    console.log(
      `⚠ Servidor de app no accesible en ${BASE_URL}: vectores 9–11 SKIPPED.\n` +
        "  Arranca `npm run dev` en otra terminal para ejercer los route handlers.\n",
    );
  } else {
    const cookie = await buildSessionCookieHeader(USER_B);

    // 9) PATCH del hilo de A como B → 404 (el hilo no es visible para B).
    {
      const res = await fetch(`${BASE_URL}/api/threads/${a.threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ title: "HACKEADO POR B" }),
      });
      record(9, "PATCH /api/threads/[idA] (cookies B)", "404", `${res.status}`,
        res.status === 404);
    }
    // 10) DELETE del hilo de A como B → 404.
    {
      const res = await fetch(`${BASE_URL}/api/threads/${a.threadId}`, {
        method: "DELETE",
        headers: { cookie },
      });
      record(10, "DELETE /api/threads/[idA] (cookies B)", "404", `${res.status}`,
        res.status === 404);
    }
    // 11) PATCH de un hilo inexistente como B → 404 (no 500): valida el fix.
    {
      const ghost = "00000000-0000-0000-0000-000000000000";
      const res = await fetch(`${BASE_URL}/api/threads/${ghost}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ title: "x" }),
      });
      record(11, "PATCH /api/threads/[inexistente] (cookies B)", "404",
        `${res.status}`, res.status === 404);
    }
  }

  // ── Verificación de integridad: el hilo de A sigue intacto ───────────────────
  {
    const { data } = await admin
      .from("threads")
      .select("id, title")
      .eq("id", a.threadId)
      .maybeSingle();
    const intact = !!data && (data.title as string).includes(MARKER);
    record(
      12,
      "Integridad: hilo de A intacto tras los ataques",
      "existe y conserva su título original",
      data ? `título="${data.title}"` : "el hilo de A FUE BORRADO",
      intact,
    );
  }

  // ── Reporte ──────────────────────────────────────────────────────────────────
  printReport();

  const failed = results.filter((r) => r.status === "FAIL");
  const skipped = results.filter((r) => r.status === "SKIP");
  if (failed.length > 0) {
    console.error(`\n✗ AUDITORÍA FALLIDA: ${failed.length} fuga(s) detectada(s).`);
    process.exit(1);
  }
  if (skipped.length > 0) {
    console.log(
      `\n✓ Sin fugas en los vectores ejecutados. ${skipped.length} vector(es) ` +
        "SKIPPED (servidor de app no accesible).",
    );
  } else {
    console.log("\n✓ AUDITORÍA SUPERADA: 0 fugas en todos los vectores.");
  }
}

function printReport(): void {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(" REPORTE — vector por vector");
  console.log("══════════════════════════════════════════════════════════════");
  for (const r of results) {
    const icon = r.status === "PASS" ? "✓" : r.status === "SKIP" ? "—" : "✗";
    console.log(
      `${icon} [${String(r.n).padStart(2)}] ${r.vector}\n` +
        `      esperado: ${r.expected}\n` +
        `      observado: ${r.observed}  → ${r.status}`,
    );
  }
}

main().catch((err) => {
  console.error("\n✗ La auditoría abortó por un error de ejecución:", err);
  process.exit(1);
});
