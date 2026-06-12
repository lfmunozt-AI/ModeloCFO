-- Verificación de aislamiento multitenant del RAG (AG02).
--
-- Demuestra que match_chunks() + la RLS de document_chunks impiden que un usuario
-- recupere chunks de OTRO usuario. No necesita la Edge Function de embeddings: usa
-- vectores 384-dim deterministas. Todo ocurre dentro de una transacción con
-- ROLLBACK final, así que NO deja datos.
--
-- Requisitos: migraciones 0001 y 0002 aplicadas, y el seed ejecutado
-- (tester1@test.local y tester2@test.local existen en auth.users).
--
-- Ejecutar en el SQL Editor de Supabase (rol service_role / postgres).

begin;

-- Ids reales de los dos usuarios sintéticos.
create temporary table _ids on commit drop as
  select
    (select id from auth.users where email = 'tester1@test.local') as a,
    (select id from auth.users where email = 'tester2@test.local') as b;

-- Un documento + un chunk por usuario (vectores opuestos para que la similitud
-- sea inequívoca). Insert como service role: bypasea RLS a propósito para montar
-- el escenario.
with ins_docs as (
  insert into public.documents (user_id, name, status)
  select a, 'doc-A.md', 'ready' from _ids
  union all
  select b, 'doc-B.md', 'ready' from _ids
  returning id, user_id, name
)
insert into public.document_chunks (document_id, user_id, chunk_index, content, embedding)
select
  d.id,
  d.user_id,
  0,
  case when d.name = 'doc-A.md'
       then 'SECRETO DE A: la reserva de A es 12000 EUR.'
       else 'SECRETO DE B: el ingreso de B es 2300 EUR.' end,
  case when d.name = 'doc-A.md'
       then array_fill(0.1, array[384])::vector
       else array_fill(-0.1, array[384])::vector end
from ins_docs d;

-- ── Consulta COMO usuario A ───────────────────────────────────────────────────
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select a from _ids), 'role', 'authenticated')::text,
  true
);

\echo '== match_chunks como usuario A (debe devolver SOLO el chunk de A) =='
select source, content
from public.match_chunks(array_fill(0.1, array[384])::vector, 5);

-- ── Consulta COMO usuario B ───────────────────────────────────────────────────
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select b from _ids), 'role', 'authenticated')::text,
  true
);

\echo '== match_chunks como usuario B (debe devolver SOLO el chunk de B) =='
select source, content
from public.match_chunks(array_fill(0.1, array[384])::vector, 5);

-- Resultado esperado:
--   · Como A: 1 fila, source = doc-A.md  (NUNCA doc-B.md)
--   · Como B: 1 fila, source = doc-B.md  (NUNCA doc-A.md)
-- Aunque el vector de consulta es idéntico, cada usuario solo ve lo suyo.

reset role;
rollback;
