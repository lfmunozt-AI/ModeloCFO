import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "../helpers/supabase-mock";

const state: { supabase: ReturnType<typeof makeSupabase> } = {
  supabase: makeSupabase(),
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(state.supabase)),
}));

import { POST } from "@/app/api/feedback/route";

const MSG = "11111111-1111-1111-1111-111111111111";
const THREAD = "22222222-2222-2222-2222-222222222222";

function req(body: unknown): Request {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.supabase = makeSupabase();
});

describe("/api/feedback", () => {
  it("401 sin sesión", async () => {
    state.supabase = makeSupabase({ user: null });
    const res = await POST(
      req({ message_id: MSG, thread_id: THREAD, rating: "positive" }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("400 con rating inválido", async () => {
    state.supabase = makeSupabase({ user: { id: "u1" } });
    const res = await POST(
      req({ message_id: MSG, thread_id: THREAD, rating: "meh" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("400 con message_id no-uuid", async () => {
    state.supabase = makeSupabase({ user: { id: "u1" } });
    const res = await POST(
      req({ message_id: "no-uuid", thread_id: THREAD, rating: "positive" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("400 con comentario >500 chars", async () => {
    state.supabase = makeSupabase({ user: { id: "u1" } });
    const res = await POST(
      req({
        message_id: MSG,
        thread_id: THREAD,
        rating: "negative",
        comment: "x".repeat(501),
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("404 si el mensaje no es del usuario", async () => {
    state.supabase = makeSupabase({
      user: { id: "u1" },
      tables: { messages: { maybeSingle: { data: null, error: null } } },
    });
    const res = await POST(
      req({ message_id: MSG, thread_id: THREAD, rating: "positive" }) as never,
    );
    expect(res.status).toBe(404);
  });

  it("404 si el thread_id no concuerda con el del mensaje", async () => {
    state.supabase = makeSupabase({
      user: { id: "u1" },
      tables: {
        messages: {
          maybeSingle: { data: { id: MSG, thread_id: "otro" }, error: null },
        },
      },
    });
    const res = await POST(
      req({ message_id: MSG, thread_id: THREAD, rating: "positive" }) as never,
    );
    expect(res.status).toBe(404);
  });

  it("503 si la tabla feedback_signals no existe", async () => {
    state.supabase = makeSupabase({
      user: { id: "u1" },
      tables: {
        messages: {
          maybeSingle: { data: { id: MSG, thread_id: THREAD }, error: null },
        },
        feedback_signals: {
          await: { data: null, error: { code: "42P01", message: "relation does not exist" } },
        },
      },
    });
    const res = await POST(
      req({ message_id: MSG, thread_id: THREAD, rating: "positive" }) as never,
    );
    expect(res.status).toBe(503);
  });

  it("201 al registrar feedback de un mensaje propio", async () => {
    state.supabase = makeSupabase({
      user: { id: "u1" },
      tables: {
        messages: {
          maybeSingle: { data: { id: MSG, thread_id: THREAD }, error: null },
        },
        feedback_signals: { await: { data: null, error: null } },
      },
    });
    const res = await POST(
      req({
        message_id: MSG,
        thread_id: THREAD,
        rating: "negative",
        comment: "faltó detalle",
        is_first_session: true,
      }) as never,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });
});
