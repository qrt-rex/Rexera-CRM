-- =====================================================================================================
-- Rexera CRM · job application forms: one or more positions per form (HR ticks them; the candidate picks one).
-- Forms saved with a single position keep it. Safe to run more than once.
-- =====================================================================================================
alter table candidate_forms add column if not exists position text check (position is null or length(position) <= 120);
alter table candidate_forms add column if not exists positions text[] not null default '{}';
update candidate_forms set positions = array[position] where position is not null and cardinality(positions) = 0;
