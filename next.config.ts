import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad aplicadas a TODAS las respuestas (AG03).
 *
 * - X-Frame-Options: DENY — la app nunca se embebe en un iframe (anti-clickjacking).
 * - X-Content-Type-Options: nosniff — el navegador respeta el Content-Type.
 * - Referrer-Policy: strict-origin-when-cross-origin — no se filtra la ruta a
 *   terceros; solo el origen en navegación cross-origin.
 * - Permissions-Policy: se desactivan APIs del navegador que la app no usa
 *   (cámara, micrófono, geolocalización, FLoC/Topics) para reducir superficie.
 *
 * CSP (Content-Security-Policy): NO se aplica aquí a propósito. Una CSP estricta
 * con Next.js App Router exige nonces por request (inline scripts/styles del
 * runtime de Next) inyectados vía middleware; mal configurada rompe la hidratación
 * y/o el streaming SSE de /api/chat. Se documenta la propuesta en el PR de AG03
 * para implementarla de forma controlada en una pasada dedicada, en vez de
 * arriesgar el chat ahora.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
