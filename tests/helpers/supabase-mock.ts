import { vi } from "vitest";

/**
 * Constructor de un mock de cliente Supabase para tests de route handlers.
 *
 * Los handlers encadenan el query builder: `.from(t).select().eq().order()...`
 * y lo terminan o bien con `.single()` (Promise) o bien haciendo `await` del
 * propio builder (es "thenable"). Modelamos ambas terminaciones con un builder
 * encadenable cuyos resultados se configuran por tabla.
 */

export interface TableResult {
  /** Resultado de `.single()` en esa tabla, p. ej. { data, error }. */
  single?: unknown;
  /** Resultado de `.maybeSingle()` (cae a `single` si no se define). */
  maybeSingle?: unknown;
  /** Resultado al hacer `await` del builder (insert/select sin single). */
  await?: unknown;
}

export interface SupabaseMockConfig {
  /** Usuario devuelto por auth.getUser(). null = no autenticado. */
  user?: { id: string } | null;
  /** Sesión devuelta por auth.getSession(). */
  session?: { access_token: string } | null;
  /** Resultados por nombre de tabla. */
  tables?: Record<string, TableResult>;
}

function makeBuilder(result: TableResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  const chainable = [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "match", "filter",
    "order", "limit", "range",
  ];
  for (const m of chainable) {
    builder[m] = vi.fn(chain);
  }
  builder.single = vi.fn(() => Promise.resolve(result.single ?? { data: null, error: null }));
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve(result.maybeSingle ?? result.single ?? { data: null, error: null }),
  );
  // Thenable: permite `await supabase.from(t)....`
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve(result.await ?? { data: null, error: null });
  return builder;
}

export function makeSupabase(config: SupabaseMockConfig = {}) {
  const { user = null, session = null, tables = {} } = config;
  const from = vi.fn((table: string) => makeBuilder(tables[table] ?? {}));

  return {
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user }, error: null })),
      getSession: vi.fn(() => Promise.resolve({ data: { session }, error: null })),
    },
    from,
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  };
}
