import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessage } from "@/lib/types";

// Mock del SDK 'openai': capturamos los args del constructor (baseURL/apiKey) y
// controlamos chat.completions.create() para simular el proveedor.
const { ctorMock, createMock } = vi.hoisted(() => ({
  ctorMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAIMock {
    chat = { completions: { create: createMock } };
    constructor(opts: unknown) {
      ctorMock(opts);
    }
  },
}));

// Helper: completion en streaming como async-iterable de chunks estilo OpenAI.
function makeCompletion(deltas: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of deltas) {
        yield { choices: [{ delta: { content } }] };
      }
    },
  };
}

// Drena el ReadableStream SSE a texto para forzar la ejecución de start().
async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

const messages: ChatMessage[] = [{ role: "user", content: "hola" }];

beforeEach(() => {
  vi.resetModules();
  ctorMock.mockClear();
  createMock.mockReset();
  process.env.LLM_BASE_URL = "https://modal.example/v1";
  process.env.LLM_API_KEY = "sk-test-123";
  process.env.LLM_MODEL = "cfo-vllm-7b";
});

describe("streamChat — configuración por entorno", () => {
  it("construye el cliente con LLM_BASE_URL/LLM_API_KEY del entorno", async () => {
    createMock.mockResolvedValue(makeCompletion(["hola"]));
    const { streamChat } = await import("@/lib/llm");

    const stream = await streamChat(messages, "system");
    await drain(stream);

    expect(ctorMock).toHaveBeenCalledWith({
      baseURL: "https://modal.example/v1",
      apiKey: "sk-test-123",
    });
  });

  it("invoca el modelo indicado en LLM_MODEL y antepone el system prompt", async () => {
    createMock.mockResolvedValue(makeCompletion(["ok"]));
    const { streamChat } = await import("@/lib/llm");

    await drain(await streamChat(messages, "Eres CFO"));

    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0];
    expect(arg.model).toBe("cfo-vllm-7b");
    expect(arg.stream).toBe(true);
    expect(arg.messages[0]).toEqual({ role: "system", content: "Eres CFO" });
    expect(arg.messages[1]).toEqual({ role: "user", content: "hola" });
  });

  it("lanza si falta una variable de entorno obligatoria", async () => {
    delete process.env.LLM_BASE_URL;
    const { streamChat } = await import("@/lib/llm");

    await expect(streamChat(messages)).rejects.toThrow(/LLM_BASE_URL/);
  });
});

describe("streamChat — formato SSE y errores del proveedor", () => {
  it("formatea los tokens como eventos SSE y cierra con [DONE]", async () => {
    createMock.mockResolvedValue(makeCompletion(["Hola", " mundo"]));
    const { streamChat } = await import("@/lib/llm");

    const out = await drain(await streamChat(messages));

    expect(out).toContain('data: {"token":"Hola"}');
    expect(out).toContain('data: {"token":" mundo"}');
    expect(out.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("pasa el texto completo acumulado a onComplete antes de cerrar", async () => {
    createMock.mockResolvedValue(makeCompletion(["uno", "dos"]));
    const onComplete = vi.fn();
    const { streamChat } = await import("@/lib/llm");

    await drain(await streamChat(messages, undefined, { onComplete }));

    expect(onComplete).toHaveBeenCalledWith("unodos");
  });

  it("propaga un error del proveedor al crear la completion (rechaza la promesa)", async () => {
    createMock.mockRejectedValue(new Error("429 Too Many Requests"));
    const { streamChat } = await import("@/lib/llm");

    await expect(streamChat(messages)).rejects.toThrow("429 Too Many Requests");
  });

  it("emite un evento SSE de error si el proveedor falla durante el streaming", async () => {
    createMock.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "parcial" } }] };
        throw new Error("stream roto");
      },
    });
    const { streamChat } = await import("@/lib/llm");

    const out = await drain(await streamChat(messages));

    expect(out).toContain('data: {"token":"parcial"}');
    expect(out).toContain('"error":"stream roto"');
    // No debe emitir [DONE] si el stream se rompió.
    expect(out).not.toContain("[DONE]");
  });
});
