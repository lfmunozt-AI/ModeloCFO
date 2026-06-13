import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "../helpers/supabase-mock";

// Holder mutable: cada test define el cliente Supabase que devolverá la factory.
const state: { supabase: ReturnType<typeof makeSupabase> } = {
  supabase: makeSupabase(),
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(state.supabase)),
}));

// RAG y LLM se prueban aparte: aquí los neutralizamos para aislar el handler.
vi.mock("@/lib/rag", () => ({
  retrieveContext: vi.fn(() => Promise.resolve([])),
  formatContext: vi.fn(() => ""),
  ingestMemoryExchange: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/llm", () => ({
  streamChat: vi.fn(() =>
    Promise.resolve(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
    ),
  ),
}));

import { POST } from "@/app/api/chat/route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.supabase = makeSupabase();
});

describe("POST /api/chat", () => {
  it("401 si no hay sesión", async () => {
    state.supabase = makeSupabase({ user: null });
    const res = await POST(makeReq({ message: "hola mundo" }) as never);
    expect(res.status).toBe(401);
  });

  it("400 si falta message", async () => {
    state.supabase = makeSupabase({ user: { id: "u1" } });
    const res = await POST(makeReq({ threadId: "t1" }) as never);
    expect(res.status).toBe(400);
  });

  it("400 si message es solo espacios en blanco", async () => {
    state.supabase = makeSupabase({ user: { id: "u1" } });
    const res = await POST(makeReq({ message: "   " }) as never);
    expect(res.status).toBe(400);
  });

  it("crea el hilo cuando threadId está ausente y devuelve X-Thread-Id", async () => {
    state.supabase = makeSupabase({
      user: { id: "u1" },
      tables: {
        // insert(threads).select('id').single() → nuevo hilo
        threads: { single: { data: { id: "new-thread-id" }, error: null } },
        // insert/select de mensajes (await del builder)
        messages: { await: { data: [], error: null } },
      },
    });

    const res = await POST(makeReq({ message: "primer mensaje del usuario" }) as never);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Thread-Id")).toBe("new-thread-id");
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    // Se insertó en 'threads' (creación al vuelo).
    expect(state.supabase.from).toHaveBeenCalledWith("threads");
  });

  it("usa el threadId provisto (verificando propiedad) sin crear hilo nuevo", async () => {
    state.supabase = makeSupabase({
      user: { id: "u1" },
      tables: {
        // select('id').eq.eq.single() → el hilo pertenece al usuario
        threads: { single: { data: { id: "t-existing" }, error: null } },
        messages: { await: { data: [], error: null } },
      },
    });

    const res = await POST(
      makeReq({ threadId: "t-existing", message: "otra pregunta" }) as never,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Thread-Id")).toBe("t-existing");
  });

  it("404 si el threadId provisto no pertenece al usuario", async () => {
    state.supabase = makeSupabase({
      user: { id: "u1" },
      tables: {
        threads: { single: { data: null, error: { message: "no rows" } } },
      },
    });

    const res = await POST(
      makeReq({ threadId: "ajeno", message: "intruso" }) as never,
    );

    expect(res.status).toBe(404);
  });
});
