-- ModeloCFO — Memoria conversacional (AG02, sesión 2).
-- Parte de 0001/0002: NO recrea nada, solo añade la memoria de conversaciones.
-- Cada par "Usuario/Asistente" relevante se embebe como un memory_chunk para que
-- el RAG lo recupere en hilos futuros. RLS multitenant por user_id.

-- pgvector ya está habilitado en 0002 (create extension if not exists vector).

-- ── memory_chunks (recuerdos de conversación; gte-small = 384 dimensiones) ─────
create table if not exists public.memory_chunks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  thread_id  uuid not null references public.threads(id) on delete cascade,
  content    text not null,
  embedding  vector(384),
  created_at timestamptz not null default now()
);

create index if not exists memory_chunks_user_id_idx
  on public.memory_chunks (user_id);

-- HNSW sobre distancia coseno (misma estrategia que document_chunks en 0002).
create index if not exists memory_chunks_embedding_hnsw_idx
  on public.memory_chunks using hnsw (embedding vector_cosine_ops);

-- ── RLS: cada usuario solo ve/gestiona sus propios recuerdos ───────────────────
alter table public.memory_chunks enable row level security;

create policy "memory_chunks_owner" on public.memory_chunks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Privilegios base para `authenticated` (la RLS hace el filtrado por fila).
grant select, insert, update, delete on public.memory_chunks to authenticated;

-- ── match_context: top-N GLOBAL sobre documentos + memoria del usuario ─────────
-- UNION ALL de ambas fuentes con un único ORDER BY + LIMIT: devuelve el top-K
-- real combinado en una sola llamada (mezclar dos RPC en código obligaría a
-- sobre-recuperar y reordenar, y no garantiza el mismo ranking en empates).
-- Cada fila llega etiquetada con su fuente: el nombre del documento, o
-- "conversación de DD/MM/AAAA" para los recuerdos.
-- SECURITY INVOKER: hereda la RLS del llamante; además filtramos por auth.uid()
-- como defensa en profundidad.
create or replace function public.match_context(
  query_embedding vector(384),
  match_count int default 5
)
returns table (
  content    text,
  source     text,
  similarity float
)
language sql
security invoker
stable
set search_path = public
as $$
  select content, source, similarity
  from (
    -- Documentos subidos por el usuario.
    select
      dc.content,
      d.name as source,
      1 - (dc.embedding <=> query_embedding) as similarity
    from public.document_chunks dc
    join public.documents d on d.id = dc.document_id
    where dc.user_id = auth.uid()
      and dc.embedding is not null

    union all

    -- Recuerdos de conversaciones anteriores.
    select
      mc.content,
      'conversación de ' || to_char(mc.created_at, 'DD/MM/YYYY') as source,
      1 - (mc.embedding <=> query_embedding) as similarity
    from public.memory_chunks mc
    where mc.user_id = auth.uid()
      and mc.embedding is not null
  ) combined
  order by similarity desc
  limit greatest(match_count, 1);
$$;

-- Cierre de privilegios de la función nueva: solo `authenticated` la ejecuta.
revoke all on function public.match_context(vector(384), int) from public;
revoke all on function public.match_context(vector(384), int) from anon;
grant execute on function public.match_context(vector(384), int) to authenticated;
