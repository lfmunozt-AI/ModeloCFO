export const CONVERSATION_STARTERS = [
  "Quiero establecer mi primera meta financiera",
  "¿Cómo identificas mis patrones de comportamiento?",
  "Explícame qué información necesitas de mí para comenzar",
] as const;

export type ConversationStarter = (typeof CONVERSATION_STARTERS)[number];
