-- =====================================================================================================
-- Rexera CRM · Sales Quiz. Safe to run more than once.
--  * quizzes: made by IT Support (or someone IT allowed "quiz.manage" by name) — 10 questions, each 2–6 options and
--    one correct answer. Drafts are edited freely; once anyone has taken a quiz its questions are frozen (make a new
--    quiz instead), and it can be archived but not deleted, so every result keeps its questions.
--  * quiz_attempts: one per Sales person per quiz. Written ONLY by the functions below (no insert / update / delete
--    rules): an answer is saved and locked the moment it is submitted, can't be changed, and the score is worked out
--    here from IT's correct answers when the quiz is finished. A Sales person never receives the correct answers
--    before finishing; they read their own attempts, IT Support reads everyone's.
-- =====================================================================================================

create table if not exists quizzes (
  id           text primary key,
  name         text not null check (length(trim(name)) between 2 and 120),
  description  text,
  status       text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  -- [{ id, text, options: [..], correct: index }]
  questions    jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 10),
  created_by   text references app_users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_by   text references app_users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists quiz_attempts (
  id          text primary key,
  quiz_id     text not null references quizzes(id) on delete restrict,
  user_id     text not null references app_users(id) on delete cascade,
  quiz_name   text not null,
  total       int not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  -- { questionId: { choice, at } } — added one at a time, never changed
  answers     jsonb not null default '{}'::jsonb,
  -- at finish: [{ id, text, options, correct, choice, ok }] — what was asked, answered and right, kept as it was
  review      jsonb,
  score       int,
  correct     int,
  incorrect   int,
  unique (quiz_id, user_id)
);
create index if not exists quiz_attempts_user_idx on quiz_attempts(user_id, started_at desc);

alter table quizzes enable row level security;
alter table quiz_attempts enable row level security;

create or replace function app.can_manage_quiz() returns boolean
language sql stable security definer set search_path = public as $$
  select app.current_user_id() is not null and (
    app.has_role('it')
    or (exists (select 1 from user_permission_overrides o where o.user_id = app.current_user_id() and o.permission = 'quiz.manage' and o.effect = 'allow')
        and not exists (select 1 from user_permission_overrides o where o.user_id = app.current_user_id() and o.permission = 'quiz.manage' and o.effect = 'deny'))
  )
$$;
grant execute on function app.can_manage_quiz() to authenticated, service_role;

drop policy if exists quizzes_manage on quizzes;
create policy quizzes_manage on quizzes for all to authenticated using (app.can_manage_quiz()) with check (app.can_manage_quiz());
drop policy if exists quiz_attempts_read on quiz_attempts;
create policy quiz_attempts_read on quiz_attempts for select to authenticated using (user_id = app.me() or app.can_manage_quiz());
-- no insert / update / delete policy on quiz_attempts: only the functions below write it

-- every question complete; 10 to publish; questions frozen once taken
create or replace function app.quiz_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from jsonb_array_elements(new.questions) e
             where length(trim(coalesce(e->>'id', ''))) = 0 or length(trim(coalesce(e->>'text', ''))) < 3
                or jsonb_typeof(e->'options') <> 'array' or jsonb_array_length(e->'options') not between 2 and 6
                or coalesce(e->>'correct', '') !~ '^\d+$' or (e->>'correct')::int >= jsonb_array_length(e->'options')) then
    raise exception 'Every question needs its text, 2–6 options and the correct answer.';
  end if;
  if new.status = 'PUBLISHED' and jsonb_array_length(new.questions) <> 10 then
    raise exception 'A quiz is published with all 10 questions.';
  end if;
  if tg_op = 'UPDATE' then
    if new.questions is distinct from old.questions and exists (select 1 from quiz_attempts a where a.quiz_id = old.id) then
      raise exception 'Sales people have already taken this quiz — its questions stay as they were. Make a new quiz to change them.';
    end if;
    if new.status = 'PUBLISHED' and old.status <> 'PUBLISHED' then new.published_at := now(); end if;
    new.updated_at := now();
  elsif new.status = 'PUBLISHED' then
    new.published_at := now();
  end if;
  return new;
end $$;
drop trigger if exists quizzes_guard on quizzes;
create trigger quizzes_guard before insert or update on quizzes for each row execute function app.quiz_guard();

-- ---------------------------------------------------------------------------------------------- what Sales calls
create or replace function app.quiz_seller() returns text
language plpgsql stable security definer set search_path = public as $$
declare me text := app.current_user_id();
begin
  if me is null or not app.has_role('sales') then
    raise exception 'The quiz is for Sales users.' using errcode = '42501';
  end if;
  return me;
end $$;

/** Open quizzes (questions without answers) and the person's own attempts. */
create or replace function public.quiz_for_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me text := app.quiz_seller();
begin
  return jsonb_build_object(
    'quizzes', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'description', q.description, 'published_at', q.published_at,
        'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', e->>'id', 'text', e->>'text', 'options', e->'options') order by n), '[]'::jsonb)
                      from jsonb_array_elements(q.questions) with ordinality as t(e, n))) order by q.published_at desc)
      from quizzes q where q.status = 'PUBLISHED'), '[]'::jsonb),
    'attempts', coalesce((select jsonb_agg(to_jsonb(a) order by a.started_at desc) from quiz_attempts a where a.user_id = me), '[]'::jsonb));
end $$;

/** Starts (or reopens) the person's attempt at an open quiz — one per quiz. */
create or replace function public.quiz_start(p_quiz text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := app.quiz_seller(); q quizzes; a quiz_attempts;
begin
  select * into q from quizzes where id = p_quiz and status = 'PUBLISHED';
  if not found then raise exception 'This quiz is not open.'; end if;
  insert into quiz_attempts (id, quiz_id, user_id, quiz_name, total)
    values ('qa-' || replace(gen_random_uuid()::text, '-', ''), q.id, me, q.name, jsonb_array_length(q.questions))
    on conflict (quiz_id, user_id) do nothing;
  select * into a from quiz_attempts where quiz_id = p_quiz and user_id = me;
  return to_jsonb(a);
end $$;

/** Saves one answer and locks it: a question already answered can't be answered again. */
create or replace function public.quiz_answer(p_attempt text, p_question text, p_choice int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := app.quiz_seller(); a quiz_attempts; q quizzes;
begin
  select * into a from quiz_attempts where id = p_attempt and user_id = me for update;
  if not found then raise exception 'Quiz not found.'; end if;
  if a.finished_at is not null then raise exception 'This quiz is finished — answers can''t change.'; end if;
  if a.answers ? p_question then raise exception 'This answer is locked — it was already submitted.'; end if;
  select * into q from quizzes where id = a.quiz_id;
  if not exists (select 1 from jsonb_array_elements(q.questions) e
                 where e->>'id' = p_question and p_choice >= 0 and p_choice < jsonb_array_length(e->'options')) then
    raise exception 'Pick one of the options.';
  end if;
  update quiz_attempts set answers = answers || jsonb_build_object(p_question, jsonb_build_object('choice', p_choice, 'at', now()))
    where id = a.id returning * into a;
  return to_jsonb(a);
end $$;

/** Finish Quiz: every question answered; the score is worked out from IT's correct answers. Finishing twice is the same as once. */
create or replace function public.quiz_finish(p_attempt text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := app.quiz_seller(); a quiz_attempts; q quizzes; v_review jsonb; v_ok int;
begin
  select * into a from quiz_attempts where id = p_attempt and user_id = me for update;
  if not found then raise exception 'Quiz not found.'; end if;
  if a.finished_at is not null then return to_jsonb(a); end if;
  select * into q from quizzes where id = a.quiz_id;
  if exists (select 1 from jsonb_array_elements(q.questions) e where not (a.answers ? (e->>'id'))) then
    raise exception 'Answer every question before finishing.';
  end if;
  select jsonb_agg(jsonb_build_object(
      'id', e->>'id', 'text', e->>'text', 'options', e->'options', 'correct', (e->>'correct')::int,
      'choice', (a.answers->(e->>'id')->>'choice')::int,
      'ok', (a.answers->(e->>'id')->>'choice')::int = (e->>'correct')::int) order by n)
    into v_review from jsonb_array_elements(q.questions) with ordinality as t(e, n);
  select count(*) into v_ok from jsonb_array_elements(v_review) r where (r->>'ok')::boolean;
  update quiz_attempts set finished_at = now(), review = v_review, score = v_ok, correct = v_ok, incorrect = jsonb_array_length(v_review) - v_ok
    where id = a.id returning * into a;
  return to_jsonb(a);
end $$;

revoke all on function public.quiz_for_me(), public.quiz_start(text), public.quiz_answer(text, text, int), public.quiz_finish(text) from public, anon;
grant execute on function public.quiz_for_me(), public.quiz_start(text), public.quiz_answer(text, text, int), public.quiz_finish(text) to authenticated;
grant execute on function app.quiz_seller(), app.quiz_guard() to authenticated, service_role;

do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['quizzes', 'quiz_attempts'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
