import { useCallback, useEffect, useState } from 'react'
import type { OpenQuiz, Quiz, QuizAttempt, QuizStatus, User } from './types'
import { CLOUD } from './cloud'
import { getSupabase } from './supabase'
import { getDb, mutate, useDb } from './store'
import { ActionError } from './actions'
import { canManageQuiz, canTakeQuiz } from './rbac'
import { nowIso, uid } from './format'
import { DEFAULT_WINDOW, fmtClock, publicQuestions, quizProblem, scoreQuiz, windowProblem, windowState } from '../../supabase/quiz-rules.mjs'

/**
 * Sales Quiz. IT Support makes quizzes (10 questions, options, the correct answer) and publishes them; Sales people
 * take each open quiz once: every answer is saved and locked the moment it is submitted, and Finish Quiz works out the
 * score from IT's correct answers.
 *
 * On the live CRM the quiz lives in Supabase and the database does the locking and scoring (functions quiz_for_me,
 * quiz_start, quiz_answer, quiz_finish — a Sales person never receives the correct answers before finishing). In the
 * browser-only demo the same rules run here.
 */
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new ActionError(msg) }
const needTaker = (me: User) => assert(canTakeQuiz(me), 'The quiz is for Sales users.')
const needManager = (me: User) => assert(canManageQuiz(me), 'Quizzes are managed by IT Support.')

// ------------------------------------------------------------------ Supabase rows → the app's shape
type Row = Record<string, unknown>
const attemptOf = (r: Row): QuizAttempt => ({
  id: r.id as string, quizId: r.quiz_id as string, userId: r.user_id as string, quizName: r.quiz_name as string, total: Number(r.total),
  startedAt: r.started_at as string, finishedAt: (r.finished_at as string) ?? undefined, answers: (r.answers as QuizAttempt['answers']) ?? {},
  review: (r.review as QuizAttempt['review']) ?? undefined, score: r.score == null ? undefined : Number(r.score),
  correct: r.correct == null ? undefined : Number(r.correct), incorrect: r.incorrect == null ? undefined : Number(r.incorrect),
})
const quizOf = (r: Row): Quiz => ({
  id: r.id as string, name: r.name as string, description: (r.description as string) ?? undefined, status: r.status as QuizStatus,
  questions: (r.questions as Quiz['questions']) ?? [], windowStart: hhmm(r.window_start, DEFAULT_WINDOW.start), windowEnd: hhmm(r.window_end, DEFAULT_WINDOW.end), createdBy: (r.created_by as string) ?? undefined, createdAt: r.created_at as string,
  updatedAt: (r.updated_at as string) ?? undefined, publishedAt: (r.published_at as string) ?? undefined,
})
const quizRow = (q: Quiz, me: User) => ({ id: q.id, name: q.name.trim(), description: q.description?.trim() || null, status: q.status, questions: q.questions, window_start: q.windowStart, window_end: q.windowEnd, created_by: q.createdBy ?? me.id, updated_by: me.id })
/** "09:15:00" → "09:15" */
const hhmm = (v: unknown, dflt: string) => (typeof v === 'string' && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : dflt)
const timeText = (q: { windowStart: string; windowEnd: string }) => `${fmtClock(q.windowStart)} to ${fmtClock(q.windowEnd)}`
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (await getSupabase()).rpc(fn, args)
  if (error) throw new ActionError(error.message.replace(/^.*?:\s*/, '') || 'The quiz could not be saved — try again.')
  return data as T
}
/** the quiz time of a quiz (older demo quizzes have none: 9:15–9:30) */
const winOf = (q: Partial<Quiz>) => ({ windowStart: q.windowStart ?? DEFAULT_WINDOW.start, windowEnd: q.windowEnd ?? DEFAULT_WINDOW.end })
/** a plain copy of a record being edited in the store (the edit's working copy is gone once it is saved) */
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const audit = (by: string, action: string, detail: string) => mutate((d) => { d.audit.unshift({ id: uid('a-'), at: nowIso(), by, action, detail }) })

// ------------------------------------------------------------------ Sales
export interface MyQuizzes { quizzes: OpenQuiz[]; attempts: QuizAttempt[] }
export async function loadMyQuizzes(me: User): Promise<MyQuizzes> {
  needTaker(me)
  if (CLOUD) {
    const r = await rpc<{ quizzes: OpenQuiz[]; attempts: Row[] }>('quiz_for_me')
    return {
      quizzes: (r.quizzes ?? []).map((q) => ({ ...q, windowStart: hhmm((q as unknown as Row).window_start, DEFAULT_WINDOW.start), windowEnd: hhmm((q as unknown as Row).window_end, DEFAULT_WINDOW.end) })),
      attempts: (r.attempts ?? []).map(attemptOf),
    }
  }
  const d = getDb()
  return {
    quizzes: (d.quizzes ?? []).filter((q) => q.status === 'PUBLISHED').sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
      .map((q) => ({ id: q.id, name: q.name, description: q.description, publishedAt: q.publishedAt, windowStart: q.windowStart ?? DEFAULT_WINDOW.start, windowEnd: q.windowEnd ?? DEFAULT_WINDOW.end, questions: publicQuestions(q.questions) })),
    attempts: (d.quizAttempts ?? []).filter((a) => a.userId === me.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  }
}
/** Starts (or reopens) the person's one attempt at this quiz. */
export async function startQuiz(me: User, quizId: string): Promise<QuizAttempt> {
  needTaker(me)
  if (CLOUD) return attemptOf(await rpc<Row>('quiz_start', { p_quiz: quizId }))
  let out: QuizAttempt | undefined
  mutate((d) => {
    const q = (d.quizzes ?? []).find((x) => x.id === quizId && x.status === 'PUBLISHED')
    assert(q, 'This quiz is not open.')
    d.quizAttempts ??= []
    out = d.quizAttempts.find((a) => a.quizId === quizId && a.userId === me.id)
    if (!out) assert(windowState(q.windowStart, q.windowEnd) === 'open', `The quiz can be taken from ${timeText(winOf(q))} (India time).`)
    if (!out) { out = { id: uid('qa-'), quizId, userId: me.id, quizName: q.name, total: q.questions.length, startedAt: nowIso(), answers: {} }; d.quizAttempts.unshift(out) }
    out = copy(out)
  })
  return out!
}
/** Saves one answer and locks it — a submitted answer can't be changed. */
export async function answerQuestion(me: User, attemptId: string, questionId: string, choice: number): Promise<QuizAttempt> {
  needTaker(me)
  assert(Number.isInteger(choice) && choice >= 0, 'Pick one of the options.')
  if (CLOUD) return attemptOf(await rpc<Row>('quiz_answer', { p_attempt: attemptId, p_question: questionId, p_choice: choice }))
  let out: QuizAttempt | undefined
  mutate((d) => {
    const a = (d.quizAttempts ?? []).find((x) => x.id === attemptId && x.userId === me.id)
    assert(a, 'Quiz not found.')
    assert(!a.finishedAt, "This quiz is finished — answers can't change.")
    assert(!a.answers[questionId], 'This answer is locked — it was already submitted.')
    const quiz = (d.quizzes ?? []).find((x) => x.id === a.quizId)
    assert(quiz, 'Quiz not found.')
    assert(windowState(quiz.windowStart, quiz.windowEnd) === 'open', `The quiz time (${timeText(winOf(quiz))}) is over — press Finish Quiz to see your score.`)
    const q = quiz.questions.find((x) => x.id === questionId)
    assert(q && choice < q.options.length, 'Pick one of the options.')
    a.answers = { ...a.answers, [questionId]: { choice, at: nowIso() } }
    out = copy(a)
  })
  return out!
}
/** Finish Quiz: every question answered; the score comes from IT's correct answers. Finishing twice = once. */
export async function finishQuiz(me: User, attemptId: string): Promise<QuizAttempt> {
  needTaker(me)
  let out: QuizAttempt
  if (CLOUD) out = attemptOf(await rpc<Row>('quiz_finish', { p_attempt: attemptId }))
  else {
    let a: QuizAttempt | undefined
    mutate((d) => {
      const found = (d.quizAttempts ?? []).find((x) => x.id === attemptId && x.userId === me.id)
      assert(found, 'Quiz not found.')
      a = found
      if (a.finishedAt) { a = copy(a); return }
      const quiz = (d.quizzes ?? []).find((x) => x.id === a!.quizId)
      assert(quiz, 'Quiz not found.')
      assert(windowState(quiz.windowStart, quiz.windowEnd) !== 'open' || quiz.questions.every((q) => a!.answers[q.id]), 'Answer every question before finishing.')
      const r = scoreQuiz(quiz.questions, a.answers)
      Object.assign(a, { finishedAt: nowIso(), review: r.review, score: r.score, correct: r.correct, incorrect: r.incorrect })
      a = copy(a)
    })
    out = a!
  }
  audit(me.id, 'QUIZ_FINISH', `${out.quizName} · ${out.score}/${out.total}`)
  return out
}

// ------------------------------------------------------------------ IT Support
export interface QuizAdmin { quizzes: Quiz[]; attempts: QuizAttempt[] }
export async function loadQuizAdmin(me: User): Promise<QuizAdmin> {
  needManager(me)
  if (CLOUD) {
    const s = await getSupabase()
    const [q, a] = await Promise.all([
      s.from('quizzes').select('*').order('created_at', { ascending: false }),
      s.from('quiz_attempts').select('*').order('started_at', { ascending: false }).limit(5000),
    ])
    if (q.error || a.error) throw new ActionError((q.error ?? a.error)!.message)
    return { quizzes: (q.data ?? []).map(quizOf), attempts: (a.data ?? []).map(attemptOf) }
  }
  const d = getDb()
  return { quizzes: [...(d.quizzes ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), attempts: [...(d.quizAttempts ?? [])] }
}
export const newQuestionId = () => uid('qq-')
/** Saves a draft or (publish) puts it live for Sales. A quiz someone has taken keeps its questions. */
export async function saveQuiz(me: User, quiz: Quiz, publish = false): Promise<Quiz> {
  needManager(me)
  const next: Quiz = { ...quiz, name: quiz.name.trim(), questions: quiz.questions.map((q) => ({ ...q, text: q.text.trim(), options: q.options.map((o) => o.trim()) })), status: publish ? 'PUBLISHED' : quiz.status === 'PUBLISHED' ? 'PUBLISHED' : quiz.status }
  const problem = quizProblem(next, { publish: next.status === 'PUBLISHED' }) ?? windowProblem(next.windowStart, next.windowEnd)
  assert(!problem, problem ?? '')
  const isNew = !quiz.createdAt
  if (CLOUD) {
    const s = await getSupabase()
    const row = quizRow(next, me)
    const r = isNew ? await s.from('quizzes').insert(row).select().single() : await s.from('quizzes').update(row).eq('id', next.id).select().single()
    if (r.error) throw new ActionError(r.error.message)
    audit(me.id, isNew ? 'QUIZ_CREATE' : 'QUIZ_EDIT', `${next.name}${publish ? ' · published' : ''}`)
    return quizOf(r.data)
  }
  let out: Quiz | undefined
  mutate((d) => {
    d.quizzes ??= []
    const i = d.quizzes.findIndex((x) => x.id === next.id)
    if (i >= 0) {
      const was = d.quizzes[i]!
      assert(JSON.stringify(was.questions) === JSON.stringify(next.questions) || !(d.quizAttempts ?? []).some((a) => a.quizId === was.id),
        'Sales people have already taken this quiz — its questions stay as they were. Make a new quiz to change them.')
      d.quizzes[i] = { ...copy(was), ...next, updatedAt: nowIso(), publishedAt: next.status === 'PUBLISHED' && was.status !== 'PUBLISHED' ? nowIso() : was.publishedAt }
      out = copy(d.quizzes[i]!)
    } else {
      out = { ...next, createdBy: me.id, createdAt: nowIso(), publishedAt: next.status === 'PUBLISHED' ? nowIso() : undefined }
      d.quizzes.unshift(copy(out))
    }
    d.audit.unshift({ id: uid('a-'), at: nowIso(), by: me.id, action: isNew ? 'QUIZ_CREATE' : 'QUIZ_EDIT', detail: `${next.name}${publish ? ' · published' : ''}` })
  })
  return out!
}
/** Publish (open for Sales), back to draft (only before anyone took it), or archive (closed; results stay). */
export async function setQuizStatus(me: User, quiz: Quiz, status: QuizStatus, taken: boolean): Promise<void> {
  needManager(me)
  assert(!(status === 'DRAFT' && taken), 'People have taken this quiz — archive it instead.')
  if (status === 'PUBLISHED') { const p = quizProblem(quiz, { publish: true }); assert(!p, p ?? '') }
  if (CLOUD) {
    const r = await (await getSupabase()).from('quizzes').update({ status, updated_by: me.id }).eq('id', quiz.id)
    if (r.error) throw new ActionError(r.error.message)
  } else {
    mutate((d) => {
      const q = (d.quizzes ?? []).find((x) => x.id === quiz.id)
      assert(q, 'Quiz not found.')
      if (status === 'PUBLISHED' && q.status !== 'PUBLISHED') q.publishedAt = nowIso()
      q.status = status; q.updatedAt = nowIso()
    })
  }
  audit(me.id, 'QUIZ_STATUS', `${quiz.name} → ${status.toLowerCase()}`)
}
/** Only a quiz nobody has taken can be deleted (results always keep their quiz). */
export async function deleteQuiz(me: User, quiz: Quiz, taken: boolean): Promise<void> {
  needManager(me)
  assert(!taken, 'People have taken this quiz — archive it instead, so their results stay.')
  if (CLOUD) {
    const r = await (await getSupabase()).from('quizzes').delete().eq('id', quiz.id)
    if (r.error) throw new ActionError(r.error.message)
  } else mutate((d) => { d.quizzes = (d.quizzes ?? []).filter((x) => x.id !== quiz.id) })
  audit(me.id, 'QUIZ_DELETE', quiz.name)
}

// ------------------------------------------------------------------ live data for the screens
/**
 * Loads with `load`, and again when the data changes: the browser store in demo mode, Supabase Realtime on the live
 * CRM (quizzes / quiz_attempts), and when the window comes back into focus.
 */
export function useQuizData<T>(load: () => Promise<T>, enabled = true) {
  const db = useDb()
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: enabled })
  const reload = useCallback(() => {
    if (!enabled) return
    load().then((data) => setState({ data, loading: false }), (e: Error) => setState((s) => ({ ...s, error: e.message, loading: false })))
  }, [load, enabled])
  useEffect(() => { reload() }, [reload, CLOUD ? null : db.quizzes, CLOUD ? null : db.quizAttempts]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enabled) return
    const on = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', on)
    if (!CLOUD) return () => document.removeEventListener('visibilitychange', on)
    let ch: { unsubscribe: () => unknown } | null = null
    void getSupabase().then((s) => {
      ch = s.channel(`quiz-${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'quizzes' }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_attempts' }, reload)
        .subscribe()
    })
    return () => { document.removeEventListener('visibilitychange', on); void ch?.unsubscribe() }
  }, [reload, enabled])
  return { ...state, reload }
}
