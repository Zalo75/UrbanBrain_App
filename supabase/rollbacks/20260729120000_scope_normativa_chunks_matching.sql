begin;

drop function if exists public.match_normativa_chunks_scoped(vector, integer, text, text[], text);

notify pgrst, 'reload schema';

commit;
