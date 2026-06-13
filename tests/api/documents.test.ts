import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "../helpers/supabase-mock";

const state: { supabase: ReturnType<typeof makeSupabase> } = {
  supabase: makeSupabase(),
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(state.supabase)),
}));

// La ingesta real (PDF/embeddings) se prueba aparte; aquí validamos la guarda
// de la ruta (sesión, tamaño, tipo) antes de llegar al pipeline.
const { ingestDocument } = vi.hoisted(() => ({
  ingestDocument: vi.fn((..._args: unknown[]) =>
    Promise.resolve({ chunks: 1, status: "ready" as const }),
  ),
}));
vi.mock("@/lib/rag", () => ({
  ingestDocument,
}));

import { POST } from "@/app/api/documents/route";

function formReq(file: File | null): Request {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request("http://localhost/api/documents", {
    method: "POST",
    body: form,
  });
}

const authed = () =>
  makeSupabase({
    user: { id: "u1" },
    session: { access_token: "jwt-abc" },
    tables: { documents: { single: { data: { id: "doc1" }, error: null } } },
  });

beforeEach(() => {
  state.supabase = authed();
  ingestDocument.mockClear();
});

describe("POST /api/documents", () => {
  it("401 sin sesión", async () => {
    state.supabase = makeSupabase({ user: null });
    const file = new File(["hola"], "nota.txt", { type: "text/plain" });
    const res = await POST(formReq(file) as never);
    expect(res.status).toBe(401);
    expect(ingestDocument).not.toHaveBeenCalled();
  });

  it("413 si el archivo supera 5 MB", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1); // 5 MB + 1 byte
    const file = new File([big], "grande.pdf", { type: "application/pdf" });
    const res = await POST(formReq(file) as never);
    expect(res.status).toBe(413);
    expect(ingestDocument).not.toHaveBeenCalled();
  });

  it("415 si el tipo de archivo no está soportado", async () => {
    const file = new File(["MZ..."], "virus.exe", {
      type: "application/octet-stream",
    });
    const res = await POST(formReq(file) as never);
    expect(res.status).toBe(415);
    expect(ingestDocument).not.toHaveBeenCalled();
  });

  it("acepta un .txt válido → 201 y dispara la ingesta", async () => {
    const file = new File(["contenido de prueba"], "nota.txt", {
      type: "text/plain",
    });
    const res = await POST(formReq(file) as never);
    expect(res.status).toBe(201);
    expect(ingestDocument).toHaveBeenCalledTimes(1);
  });
});
