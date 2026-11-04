-- =====================================================================================================
-- Rexera CRM · Sales Quiz time. Safe to run more than once. Needs 20261105000000_quiz.sql first.
--  * Every quiz has a daily time, India time — 9:15 to 9:30 am unless IT Support sets another (only IT Support
--    edits quizzes, so only IT Support sets the time).
--  * Sales start a quiz and submit answers only inside that time; the database checks the clock, not the browser.
--  * After the time ends, Finish Quiz still works for someone part-way through: the questions they didn't reach
--    count as incorrect. Before it ends, every question must be answered to finish.
-- =====================================================================================================
alter table quizzes add column if not exists window_start time not null default '09:15';
alter table quizzes add column if not exists window_end   time not null default '09:30';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quizzes_window_order') then
    alter table quizzes add constraint quizzes_window_order check (window_start < window_end);
  end if;
end $$;

-- the time of day in India
create or replace function app.ist_now() returns time
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::time $$;
grant execute on function app.ist_now() to authenticated, service_role;

/** Open quizzes (questions without answers, the quiz time) and the person's own attempts. */
create or replace function public.quiz_for_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me text := app.quiz_seller();
begin
  return jsonb_build_object(
    'quizzes', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'description', q.description, 'published_at', q.published_at,
        'window_start', to_char(q.window_start, 'HH24:MI'), 'window_end', to_char(q.window_end, 'HH24:MI'),
        'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', e->>'id', 'text', e->>'text', 'options', e->'options') order by n), '[]'::jsonb)
                      from jsonb_array_elements(q.questions) with ordinality as t(e, n))) order by q.published_at desc)
      from quizzes q where q.status = 'PUBLISHED'), '[]'::jsonb),
    'attempts', coalesce((select jsonb_agg(to_jsonb(a) order by a.started_at desc) from quiz_attempts a where a.user_id = me), '[]'::jsonb),
    'now', to_char(app.ist_now(), 'HH24:MI:SS'));
end $$;

create or replace function public.quiz_start(p_quiz text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := app.quiz_seller(); q quizzes; a quiz_attempts;
begin
  select * into q from quizzes where id = p_quiz and status = 'PUBLISHED';
  if not found then raise exception 'This quiz is not open.'; end if;
  select * into a from quiz_attempts where quiz_id = p_quiz and user_id = me;
  if found then return to_jsonb(a); end if;
  if app.ist_now() < q.window_start or app.ist_now() >= q.window_end then
    raise exception 'The quiz can be taken from % to % (India time).', to_char(q.window_start, 'HH12:MI am'), to_char(q.window_end, 'HH12:MI am');
  end if;
  insert into quiz_attempts (id, quiz_id, user_id, quiz_name, total)
    values ('qa-' || replace(gen_random_uuid()::text, '-', ''), q.id, me, q.name, jsonb_array_length(q.questions))
    on conflict (quiz_id, user_id) do nothing;
  select * into a from quiz_attempts where quiz_id = p_quiz and user_id = me;
  return to_jsonb(a);
end $$;

create or replace function public.quiz_answer(p_attempt text, p_question text, p_choice int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := app.quiz_seller(); a quiz_attempts; q quizzes;
begin
  select * into a from quiz_attempts where id = p_attempt and user_id = me for update;
  if not found then raise exception 'Quiz not found.'; end if;
  if a.finished_at is not null then raise exception 'This quiz is finished — answers can''t change.'; end if;
  if a.answers ? p_question then raise exception 'This answer is locked — it was already submitted.'; end if;
  select * into q from quizzes where id = a.quiz_id;
  if app.ist_now() < q.window_start or app.ist_now() >= q.window_end then
    raise exception 'The quiz time (% to %) is over — press Finish Quiz to see your score.', to_char(q.window_start, 'HH12:MI am'), to_char(q.window_end, 'HH12:MI am');
  end if;
  if not exists (select 1 from jsonb_array_elements(q.questions) e
                 where e->>'id' = p_question and p_choice >= 0 and p_choice < jsonb_array_length(e->'options')) then
    raise exception 'Pick one of the options.';
  end if;
  update quiz_attempts set answers = answers || jsonb_build_object(p_question, jsonb_build_object('choice', p_choice, 'at', now()))
    where id = a.id returning * into a;
  return to_jsonb(a);
end $$;

/** Finish Quiz: every question answered — or the quiz time is over (unanswered = incorrect). Finishing twice = once. */
create or replace function public.quiz_finish(p_attempt text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := app.quiz_seller(); a quiz_attempts; q quizzes; v_review jsonb; v_ok int;
begin
  select * into a from quiz_attempts where id = p_attempt and user_id = me for update;
  if not found then raise exception 'Quiz not found.'; end if;
  if a.finished_at is not null then return to_jsonb(a); end if;
  select * into q from quizzes where id = a.quiz_id;
  if app.ist_now() < q.window_end and app.ist_now() >= q.window_start
     and exists (select 1 from jsonb_array_elements(q.questions) e where not (a.answers ? (e->>'id'))) then
    raise exception 'Answer every question before finishing.';
  end if;
  select jsonb_agg(jsonb_build_object(
      'id', e->>'id', 'text', e->>'text', 'options', e->'options', 'correct', (e->>'correct')::int,
      'choice', (a.answers->(e->>'id')->>'choice')::int,
      'ok', coalesce((a.answers->(e->>'id')->>'choice')::int = (e->>'correct')::int, false)) order by n)
    into v_review from jsonb_array_elements(q.questions) with ordinality as t(e, n);
  select count(*) into v_ok from jsonb_array_elements(v_review) r where (r->>'ok')::boolean;
  update quiz_attempts set finished_at = now(), review = v_review, score = v_ok, correct = v_ok, incorrect = jsonb_array_length(v_review) - v_ok
    where id = a.id returning * into a;
  return to_jsonb(a);
end $$;

revoke all on function public.quiz_for_me(), public.quiz_start(text), public.quiz_answer(text, text, int), public.quiz_finish(text) from public, anon;
grant execute on function public.quiz_for_me(), public.quiz_start(text), public.quiz_answer(text, text, int), public.quiz_finish(text) to authenticated;
