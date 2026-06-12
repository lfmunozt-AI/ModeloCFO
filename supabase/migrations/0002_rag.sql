-- ModeloCFO — RAG vectorial (AG02, datos).
-- Parte de 0001_init.sql: NO recrea threads/messages/documents, solo amplía.
-- Añade pgvector, los chunks vectorizados de cada documento y la función de
-- búsqueda por similitud. RLS multitenant por user_id en TODAS las tablas nuevas.

-- ── extensión pgvector ───────────────────────────────────────────────────────
create extension if not exists vector;

-- ── documents: estado del pipeline de ingesta ────────────────────────────────
-- 'processing' al crear · 'ready' cuando hay chunks · 'error' si falló el parseo.
alter table public.documents
  add column if not exists status text not null default 'processing'
  check (status in ('processing', 'ready', 'error'));

-- ── document_chunks (fragmentos embebidos; gte-small = 384 dimensiones) ────────
create table if not exists public.document_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  chunk_index int  not null,
  content     text not null,
  embedding   vector(384),
  created_at  timestamptz not null default now()
);

create index if not exists document_chunks_document_id_idx
  on public.document_chunks (document_id);

-- HNSW sobre distancia coseno: búsqueda aproximada rápida de vecinos más cercanos.
create index if not exists document_chunks_embedding_hnsw_idx
  on public.document_chunks using hnsw (embedding vector_cosine_ops);

-- ── RLS: cada usuario solo ve/gestiona sus propios chunks ─────────────────────
alter table public.document_chunks enable row level security;

create policy "document_chunks_owner" on public.document_chunks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Privilegios base para el rol `authenticated` (la RLS de arriba hace el filtrado
-- por fila). Explícito para no depender de los default privileges del proyecto.
grant select, insert, update, delete on public.document_chunks to authenticated;

-- ── match_chunks: top-N por similitud coseno, SOLO del usuario autenticado ─────
-- SECURITY INVOKER: se ejecuta con los privilegios y el contexto RLS del que la
-- llama, de modo que la política de document_chunks ya impide ver chunks ajenos.
-- Además filtramos explícitamente por auth.uid() como defensa en profundidad.
create or replace function public.match_chunks(
  query_embedding vector(384),
  match_count int default 5
)
returns table (
  id          uuid,
  document_id uuid,
  content     text,
  source      text,
  similarity  float
)
language sql
security invoker
stable
set search_path = public
as $$
  select
    dc.id,
    dc.document_id,
    dc.content,
    d.name as source,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where dc.user_id = auth.uid()
    and dc.embedding is not null
  order by dc.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_chunks(vector(384), int) to authenticated;
