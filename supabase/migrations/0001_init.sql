-- ModeloCFO — esquema inicial (AG01, arquitecto).
-- Multitenant por user_id con RLS activo en TODAS las tablas.
-- AG02 ampliará `documents` con embeddings/pgvector para el RAG.

-- ── threads ────────────────────────────────────────────────────────────────
create table if not exists public.threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default 'Nuevo hilo',
  created_at timestamptz not null default now()
);
create index if not exists threads_user_id_created_at_idx
  on public.threads (user_id, created_at desc);

-- ── messages ───────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.threads(id) on delete cascade,
  role       text not null check (role in ('system', 'user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_thread_id_created_at_idx
  on public.messages (thread_id, created_at asc);

-- ── documents (fuente del RAG; AG02 añade embeddings) ────────────────────────
create table if not exists public.documents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  content    text,
  created_at timestamptz not null default now()
);
create index if not exists documents_user_id_idx
  on public.documents (user_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.threads   enable row level security;
alter table public.messages  enable row level security;
alter table public.documents enable row level security;

-- threads: el usuario solo ve/gestiona los suyos.
create policy "threads_owner" on public.threads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- messages: acceso vía propiedad del hilo.
create policy "messages_owner" on public.messages
  for all
  using (
    exists (
      select 1 from public.threads t
      where t.id = messages.thread_id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.threads t
      where t.id = messages.thread_id and t.user_id = auth.uid()
    )
  );

-- documents: el usuario solo ve/gestiona los suyos.
create policy "documents_owner" on public.documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
