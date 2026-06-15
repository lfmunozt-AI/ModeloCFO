-- ModeloCFO — RLHF: captura estructurada de feedback (AG02, sesión 3).
-- Parte de 0001/0002/0003: NO recrea nada. Almacena las señales 👍/👎 sobre las
-- respuestas del asistente para reentrenar el Oracle (Mistral 7B + LoRA Unsloth).
-- RLS multitenant por user_id. Ver docs/RLHF_PIPELINE.md y scripts/export-rlhf.ts.

-- ── feedback_signals ───────────────────────────────────────────────────────────
create table if not exists public.feedback_signals (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  message_id       uuid not null references public.messages(id) on delete cascade,
  thread_id        uuid not null references public.threads(id) on delete cascade,
  rating           text not null check (rating in ('positive', 'negative')),
  comment          text check (char_length(comment) <= 500),
  is_first_session boolean not null default false,
  created_at       timestamptz not null default now(),
  -- Un usuario emite una sola señal por mensaje; al re-votar se hace UPDATE.
  constraint one_feedback_per_message unique (user_id, message_id)
);

-- Índice para el script de exportación (barre por rating en orden temporal).
create index if not exists feedback_signals_rating_created_at_idx
  on public.feedback_signals (rating, created_at);

-- Índice para el análisis de primera sesión (señales de mayor peso).
create index if not exists feedback_signals_first_session_rating_idx
  on public.feedback_signals (is_first_session, rating);

-- ── RLS: cada usuario solo ve/gestiona sus propias señales ─────────────────────
alter table public.feedback_signals enable row level security;

-- SELECT/INSERT/UPDATE para el dueño. NO hay policy de DELETE: el usuario cambia
-- su voto (UPDATE), no lo borra. El borrado queda reservado al service role, que
-- bypasea RLS (p. ej. purga/anonimización administrativa).
create policy "feedback_signals_select_owner" on public.feedback_signals
  for select using (auth.uid() = user_id);

create policy "feedback_signals_insert_owner" on public.feedback_signals
  for insert with check (auth.uid() = user_id);

create policy "feedback_signals_update_owner" on public.feedback_signals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Privilegios base para `authenticated` (la RLS filtra por fila). Sin DELETE.
grant select, insert, update on public.feedback_signals to authenticated;

-- Nota: esta migración no introduce funciones nuevas, por lo que no hay execute
-- que revocar de public/anon. (Las funciones de 0002/0003 ya cierran ese acceso.)
