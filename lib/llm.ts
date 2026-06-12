import OpenAI from "openai";
import type { ChatMessage } from "./types";

/**
 * Cliente LLM único y agnóstico de proveedor.
 *
 * TODA la app habla con el LLM a través de este módulo. El proveedor se decide
 * exclusivamente por variables de entorno:
 *   - LLM_BASE_URL : endpoint compatible con la API de OpenAI
 *   - LLM_API_KEY  : credencial del endpoint
 *   - LLM_MODEL    : id del modelo a invocar
 *
 * Hoy apunta a OpenAI (gpt-4o-mini). Mañana apuntará a un endpoint vLLM en Modal
 * (ver docs/MODAL_DEPLOY.md). Cambiar de proveedor = cambiar SOLO esas variables.
 * Nada en el código asume que el proveedor es OpenAI: usamos el SDK 'openai'
 * únicamente como cliente del protocolo HTTP compatible.
 */

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Revisa .env.example y tu .env.local.`,
    );
  }
  return value;
}

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!cachedClient) {
    cachedClient = new OpenAI({
      baseURL: getEnv("LLM_BASE_URL"),
      apiKey: getEnv("LLM_API_KEY"),
    });
  }
  return cachedClient;
}

const encoder = new TextEncoder();

/** Formatea un evento SSE estándar (`data: <payload>\n\n`). */
function sse(payload: string): Uint8Array {
  return encoder.encode(`data: ${payload}\n\n`);
}

export interface StreamChatOptions {
  /**
   * Se invoca una vez cuando el stream termina, con el texto completo acumulado.
   * El consumidor lo usa para persistir la respuesta del asistente. Se espera
   * (await) antes de cerrar el stream para garantizar el guardado.
   */
  onComplete?: (fullText: string) => void | Promise<void>;
  /** temperatura del muestreo. Default 0.7. */
  temperature?: number;
}

/**
 * Lanza una completion en streaming y devuelve un `ReadableStream` ya formateado
 * como SSE (`data: <token>\n\n`, cerrado con `data: [DONE]\n\n`).
 *
 * El handler de la API solo tiene que devolver este stream en la respuesta con
 * `Content-Type: text/event-stream`.
 */
export async function streamChat(
  messages: ChatMessage[],
  systemPrompt?: string,
  options: StreamChatOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  const client = getClient();
  const model = getEnv("LLM_MODEL");

  const fullMessages: ChatMessage[] = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  const completion = await client.chat.completions.create({
    model,
    messages: fullMessages,
    stream: true,
    temperature: options.temperature ?? 0.7,
  });

  let fullText = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) {
            fullText += delta;
            controller.enqueue(sse(JSON.stringify({ token: delta })));
          }
        }
        if (options.onComplete) {
          await options.onComplete(fullText);
        }
        controller.enqueue(sse("[DONE]"));
        controller.close();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Error desconocido del LLM";
        controller.enqueue(sse(JSON.stringify({ error: message })));
        controller.close();
      }
    },
  });
}
