import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "../helpers/supabase-mock";

const state: { supabase: ReturnType<typeof makeSupabase> } = {
  supabase: makeSupabase(),
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(state.supabase)),
}));

import { GET, PATCH, DELETE } from "@/app/api/threads/[id]/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/threads/t1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.supabase = makeSupabase();
});

describe("/api/threads/[id]", () => {
  it("PATCH → 401 sin sesión", async () => {
    state.supabase = makeSupabase({ user: null });
    const res = await PATCH(jsonReq({ title: "nuevo" }) as never, params("t1"));
    expect(res.status).toBe(401);
  });

  it("DELETE → 401 sin sesión", async () => {
    state.supabase = makeSupabase({ user: null });
    const res = await DELETE(
      new Request("http://localhost/api/threads/t1", { method: "DELETE" }) as never,
      params("t1"),
    );
    expect(res.status).toBe(401);
  });

  // Fix entregado por AG03 (commit 4a519be), ya en main tras el rebase: PATCH
  // usa .maybeSingle() y DELETE comprueba las filas afectadas; ambos responden
  // 404 (no 500/204) cuando el hilo no existe o es de otro usuario.
  it("PATCH → 404 si el hilo no existe o no es del usuario", async () => {
    state.supabase = makeSupabase({
      user: { id: "u1" },
      tables: {
        // .eq('user_id', u1).maybeSingle() sin fila (data null, sin error) → ajeno.
        threads: { maybeSingle: { data: null, error: null } },
      },
    });

    const res = await PATCH(jsonReq({ title: "nuevo" }) as never, params("ajeno"));
    expect(res.status).toBe(404);
  });

  it("DELETE → 404 si el hilo no existe o no es del usuario", async () => {
    state.supabase = makeSupabase({
      user: { id: "u1" },
      tables: {
        // delete().eq().eq().select('id') no afecta filas → [] → 404.
        threads: { await: { data: [], error: null } },
      },
    });

    const res = await DELETE(
      new Request("http://localhost/api/threads/ajeno", { method: "DELETE" }) as never,
      params("ajeno"),
    );
    expect(res.status).toBe(404);
  });

  it("GET → 401 sin sesión", async () => {
    state.supabase = makeSupabase({ user: null });
    const res = await GET(
      new Request("http://localhost/api/threads/t1") as never,
      params("t1"),
    );
    expect(res.status).toBe(401);
  });

  it("GET → 404 si el hilo no es del usuario", async () => {
    state.supabase = makeSupabase({
      user: { id: "u1" },
      tables: { threads: { maybeSingle: { data: null, error: null } } },
    });
    const res = await GET(
      new Request("http://localhost/api/threads/ajeno") as never,
      params("ajeno"),
    );
    expect(res.status).toBe(404);
  });

  it("GET → 200 con los mensajes del hilo propio", async () => {
    state.supabase = makeSupabase({
      user: { id: "u1" },
      tables: {
        threads: { maybeSingle: { data: { id: "t1" }, error: null } },
        messages: {
          await: {
            data: [{ id: "m1", role: "user", content: "hola" }],
            error: null,
          },
        },
      },
    });
    const res = await GET(
      new Request("http://localhost/api/threads/t1") as never,
      params("t1"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[] };
    expect(body.messages).toHaveLength(1);
  });

  it("PATCH → 200 al renombrar un hilo propio", async () => {
    state.supabase = makeSupabase({
      user: { id: "u1" },
      tables: {
        threads: {
          maybeSingle: {
            data: { id: "t1", title: "nuevo", created_at: "2026-01-01", user_id: "u1" },
            error: null,
          },
        },
      },
    });

    const res = await PATCH(jsonReq({ title: "nuevo" }) as never, params("t1"));
    expect(res.status).toBe(200);
  });
});
