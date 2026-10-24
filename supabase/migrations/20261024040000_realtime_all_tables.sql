-- =====================================================================================================
-- Rexera CRM · live updates for every table: each open CRM screen gets other people's changes at once (row-level
-- security still decides who sees what). Adds any table not yet in the realtime publication. Safe to run more than once.
-- =====================================================================================================
do $$ declare t text; begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
  for t in select tablename from pg_tables where schemaname = 'public' and tablename not in ('login_attempts', 'reminder_log') loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
