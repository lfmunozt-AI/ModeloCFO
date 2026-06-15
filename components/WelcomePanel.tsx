"use client";

// TODO(AG08): unificar con `lib/starters.ts` cuando exista. El archivo aún no
// está en el repo, así que definimos el array localmente como fallback con los
// mismos valores (mismo contrato: string[] enviado al chat tal cual).
const STARTERS = [
  "Quiero establecer mi primera meta financiera",
  "¿Cómo identificas mis patrones de comportamiento?",
  "Explícame qué información necesitas de mí para comenzar",
];

interface WelcomePanelProps {
  /** Envía el texto al chat como si el usuario lo hubiera escrito. */
  onStart: (text: string) => void;
  /** Deshabilita los starters mientras hay un envío en curso. */
  disabled?: boolean;
}

/**
 * Panel de bienvenida de la primera sesión (cuando el usuario no tiene hilos).
 * Se muestra encima del MessageInput y desaparece al crearse el primer hilo.
 * El texto es contractual: no alterar.
 */
export default function WelcomePanel({ onStart, disabled }: WelcomePanelProps) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-2">
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900/40">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Monoend by andgcore — Fase de Evaluación
        </h2>

        <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          <p>
            Estás interactuando con The Consigliere, un modelo de inteligencia
            artificial desarrollado por andgcore Corporate, entrenado
            específicamente para identificar patrones de comportamiento
            financiero y acompañarte en el cumplimiento de metas personales.
            Esta no es una app de contabilidad: no genera reportes de gastos ni
            te trata como un contador. Identifica patrones y recomienda acciones
            concretas para acercarte a los objetivos que defines en conjunto con
            el modelo.
          </p>
          <p>
            La plataforma opera bajo políticas estrictas de encriptación y
            aislamiento de datos (Row Level Security). Es un entorno
            multitenant: ningún dato tuyo es accesible para otros usuarios. No
            compartas datos de identificación personal (nombre completo,
            documento de identidad, credenciales bancarias). Comparte únicamente
            información transaccional: montos, categorías, fechas, metas.
          </p>
          <p>
            Lo que ves ahora es la interfaz de evaluación, no el producto final.
            La versión MVP de Monoend será un AaaS (Agent as a Service)
            predictivo capaz de guiar en tiempo real el cumplimiento de cada
            meta financiera personal, tomando acciones autónomas con tu
            consentimiento previo. El acercamiento al 100% de tus objetivos
            depende directamente de la calidad de la información que entregues al
            modelo.
          </p>
          <p>
            Hola, soy The Consigliere, un modelo creado por andgcore Corporate.
            Aprendo de cada conversación — si una respuesta te parece útil o
            puede mejorar, dímelo con 👍 o 👎. Tu criterio contribuye
            directamente a mi entrenamiento y me hace más preciso con cada
            interacción.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStart(s)}
              disabled={disabled}
              className="rounded-xl border border-zinc-300 px-3 py-2 text-left text-sm text-zinc-700 hover:border-zinc-400 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
