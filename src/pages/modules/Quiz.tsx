import { useCallback, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Archive, BarChart3, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Copy, Download, Eye, GraduationCap, Lock, Pencil, Play, Plus, RefreshCcw, Rocket, Save, Trash2, Trophy, Undo2, XCircle } from 'lucide-react'
import type { OpenQuiz, Quiz, QuizAttempt, QuizQuestion, QuizStatus } from '../../lib/types'
import { useDb } from '../../lib/store'
import { useMe } from '../../lib/auth'
import { userName } from '../../lib/actions'
import { canManageQuiz, canTakeQuiz } from '../../lib/rbac'
import { answerQuestion, deleteQuiz, finishQuiz, loadMyQuizzes, loadQuizAdmin, newQuestionId, saveQuiz, setQuizStatus, startQuiz, useQuizData } from '../../lib/quiz'
import { downloadCsv, fmtDateTime } from '../../lib/format'
import { MAX_OPTIONS, MIN_OPTIONS, QUIZ_SIZE, quizFeedback, quizProblem } from '../../../supabase/quiz-rules.mjs'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Input, Modal, PageHeader, Select, Table, Tabs, Td, Textarea, Th, useConfirm, useRun } from '../../components/ui'

/**
 * Sales Quiz. Sales people: open quizzes, one question at a time — each answer is saved and locked when submitted —
 * then Finish Quiz, the score pop-up and a full review. IT Support: make, edit, publish and archive quizzes, and every
 * Sales person's results. The live CRM stores everything in Supabase and the database locks answers and scores.
 */
export default function QuizPage() {
  const me = useMe()
  const manage = canManageQuiz(me), take = canTakeQuiz(me)
  const [params, setParams] = useSearchParams()
  const tabs = [
    ...(take ? [{ id: 'mine' as const, label: 'My quizzes', icon: GraduationCap }] : []),
    ...(manage ? [{ id: 'manage' as const, label: 'Quiz management', icon: Pencil }, { id: 'results' as const, label: 'Results', icon: BarChart3 }] : []),
  ]
  const tab = tabs.find((t) => t.id === params.get('tab'))?.id ?? tabs[0]?.id
  return (
    <div>
      <PageHeader title="Sales Quiz" icon={GraduationCap}
        subtitle={manage ? 'Make quizzes of 10 questions, publish them for the Sales team, and see every result.' : 'Ten questions. Each answer is saved and locked when you submit it — read carefully.'}
        actions={tabs.length > 1 && tab && <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={tabs} />} />
      {!tab && <Card><EmptyState icon={GraduationCap} title="The quiz is for the Sales team" text="Sales people take quizzes; IT Support makes them." /></Card>}
      {tab === 'mine' && <MyQuizzes />}
      {tab === 'manage' && <QuizManagement />}
      {tab === 'results' && <QuizResults />}
    </div>
  )
}

// ============================================================ Sales: take a quiz
function MyQuizzes() {
  const me = useMe()
  const load = useCallback(() => loadMyQuizzes(me), [me])
  const { data, error, loading, reload } = useQuizData(load)
  const [params, setParams] = useSearchParams()
  const playing = params.get('play'), reviewing = params.get('review')
  const [popup, setPopup] = useState<QuizAttempt | null>(null)
  const attemptFor = (id: string) => data?.attempts.find((a) => a.quizId === id)

  const quiz = playing ? data?.quizzes.find((q) => q.id === playing) : undefined
  const review = reviewing ? data?.attempts.find((a) => a.id === reviewing) : undefined
  if (error) return <Card className="p-4 text-sm text-bad">{error}</Card>
  if (loading && !data) return <Card className="p-6 text-sm text-mute">Loading quizzes…</Card>
  if (quiz) return <QuizRunner quiz={quiz} initial={attemptFor(quiz.id)} onBack={() => setParams({})} onFinished={(a) => { setPopup(a); reload(); setParams({ review: a.id }) }} />
  if (review?.finishedAt) return <><QuizReview attempt={review} who={me.name} onBack={() => setParams({})} /><ScorePopup attempt={popup} onClose={() => setPopup(null)} /></>

  const open = data?.quizzes ?? []
  const done = (data?.attempts ?? []).filter((a) => a.finishedAt)
  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <CardHeader title="Open quizzes" subtitle="Each quiz can be taken once. Answers lock when you submit them." icon={GraduationCap}
          action={<Button size="sm" variant="ghost" icon={RefreshCcw} aria-label="Refresh" onClick={reload} />} />
        {!open.length ? <EmptyState icon={GraduationCap} title="No quiz open right now" text="IT Support publishes quizzes here — you'll see a Start Quiz button on your dashboard." /> : (
          <ul className="divide-y divide-line/70">
            {open.map((q) => {
              const a = attemptFor(q.id)
              const answered = a ? Object.keys(a.answers).length : 0
              return (
                <li key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand-ink"><GraduationCap className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm">{q.name}</b>
                    <span className="block truncate text-xs text-mute">{q.questions.length} questions · ID {q.id}{q.description ? ` · ${q.description}` : ''}</span>
                  </span>
                  {a?.finishedAt ? <>
                    <Badge tone={scoreTone(a.score ?? 0)}>Score {a.score}/{a.total}</Badge>
                    <Button size="sm" variant="soft" icon={Eye} onClick={() => setParams({ review: a.id })}>Review</Button>
                  </> : a ? <>
                    <Badge tone="amber">In progress · {answered}/{q.questions.length}</Badge>
                    <Button size="sm" variant="accent" icon={Play} onClick={() => setParams({ play: q.id })}>Continue</Button>
                  </> : <Button size="sm" variant="accent" icon={Play} onClick={() => setParams({ play: q.id })}>Start Quiz</Button>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      <AttemptsTable title="My results" attempts={done} onOpen={(a) => setParams({ review: a.id })} />
    </div>
  )
}

const scoreTone = (s: number) => (s >= 8 ? 'green' : s >= 5 ? 'amber' : 'red') as 'green' | 'amber' | 'red'

/** One question at a time: pick, Submit answer (saved and locked), next; Finish Quiz when all are answered. */
function QuizRunner({ quiz, initial, onBack, onFinished }: { quiz: OpenQuiz; initial?: QuizAttempt; onBack: () => void; onFinished: (a: QuizAttempt) => void }) {
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const [attempt, setAttempt] = useState<QuizAttempt | undefined>(initial)
  const [starting, setStarting] = useState(false)
  const firstOpen = Math.max(0, quiz.questions.findIndex((q) => !initial?.answers[q.id]))
  const [i, setI] = useState(firstOpen)
  const [pick, setPick] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const q = quiz.questions[i]!
  const locked = attempt?.answers[q.id]
  const answered = attempt ? quiz.questions.filter((x) => attempt.answers[x.id]).length : 0
  const all = answered === quiz.questions.length

  const begin = async () => {
    setStarting(true)
    const a = await run(() => startQuiz(me, quiz.id))
    if (a && typeof a === 'object') { setAttempt(a); setI(Math.max(0, quiz.questions.findIndex((x) => !a.answers[x.id]))) }
    setStarting(false)
  }
  const go = (n: number) => { setI(n); setPick(null) }
  const submit = async () => {
    if (!attempt || pick == null) return
    if (!(await confirm('Submit this answer?', `“${q.options[pick]}” — once submitted it is locked and can't be changed.`))) return
    setBusy(true)
    const a = await run(() => answerQuestion(me, attempt.id, q.id, pick), 'Answer saved and locked')
    setBusy(false)
    if (a && typeof a === 'object') {
      setAttempt(a); setPick(null)
      const next = quiz.questions.findIndex((x, n) => n > i && !a.answers[x.id])
      if (next >= 0) setI(next)
    }
  }
  const finish = async () => {
    if (!attempt) return
    setBusy(true)
    const a = await run(() => finishQuiz(me, attempt.id))
    setBusy(false)
    if (a && typeof a === 'object') onFinished(a)
  }

  if (!attempt) return (
    <Card className="mx-auto max-w-2xl p-6 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-xl bg-accent-soft text-accent"><GraduationCap className="size-7" /></span>
      <h2 className="mt-3 text-xl font-extrabold">{quiz.name}</h2>
      {quiz.description && <p className="mt-1 text-sm text-mute">{quiz.description}</p>}
      <ul className="mx-auto mt-4 max-w-md space-y-1.5 text-left text-sm">
        <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />{quiz.questions.length} questions, one at a time.</li>
        <li className="flex gap-2"><Lock className="mt-0.5 size-4 shrink-0 text-warn" />Each answer is saved and <b>locked</b> when you submit it.</li>
        <li className="flex gap-2"><Trophy className="mt-0.5 size-4 shrink-0 text-accent" />Finish Quiz shows your score out of {quiz.questions.length} and the right answers.</li>
      </ul>
      <div className="mt-5 flex justify-center gap-2">
        <Button variant="outline" icon={ChevronLeft} onClick={onBack}>Back</Button>
        <Button variant="accent" icon={Play} loading={starting} onClick={begin}>Start Quiz</Button>
      </div>
    </Card>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack}>All quizzes</Button>
          <b className="min-w-0 flex-1 truncate text-sm">{quiz.name}</b>
          <span className="text-xs font-semibold text-mute">{answered} of {quiz.questions.length} answered</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-card2"><div className="h-full rounded-full bg-ok transition-all" style={{ width: `${(answered / quiz.questions.length) * 100}%` }} /></div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Questions">
          {quiz.questions.map((x, n) => (
            <button key={x.id} onClick={() => go(n)} aria-label={`Question ${n + 1}${attempt.answers[x.id] ? ' (answered)' : ''}`} aria-current={n === i}
              className={cx('grid size-8 place-items-center rounded-lg border text-xs font-bold transition', n === i ? 'border-brand bg-brand text-white' : attempt.answers[x.id] ? 'border-ok/40 bg-ok-soft text-ok' : 'border-line text-mute hover:bg-card2')}>
              {attempt.answers[x.id] && n !== i ? <Lock className="size-3" /> : n + 1}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-mute">Question {i + 1} of {quiz.questions.length}</p>
        <h2 className="mt-1 text-lg font-bold leading-snug">{q.text}</h2>
        <div className="mt-4 grid gap-2" role="radiogroup" aria-label="Answer options">
          {q.options.map((o, n) => {
            const chosen = locked ? locked.choice === n : pick === n
            return (
              <button key={n} role="radio" aria-checked={chosen} disabled={!!locked || busy} onClick={() => setPick(n)}
                className={cx('flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition disabled:cursor-default',
                  chosen ? 'border-brand bg-brand-soft font-semibold text-brand-ink ring-2 ring-brand/15' : 'border-line hover:border-brand/40 hover:bg-card2', locked && !chosen && 'opacity-55')}>
                <span className={cx('grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold', chosen ? 'border-brand bg-brand text-white' : 'border-line text-mute')}>{String.fromCharCode(65 + n)}</span>
                <span className="flex-1">{o}</span>
                {locked && chosen && <Lock className="size-4 text-brand-ink" />}
              </button>
            )
          })}
        </div>
        {locked && <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-ok"><Lock className="size-3.5" />Saved {fmtDateTime(locked.at)} — this answer is locked.</p>}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button variant="outline" icon={ChevronLeft} disabled={i === 0} onClick={() => go(i - 1)}>Previous</Button>
          {!locked && <Button icon={Lock} disabled={pick == null} loading={busy} onClick={submit}>Submit answer</Button>}
          <span className="flex-1" />
          {i < quiz.questions.length - 1 && <Button variant="ghost" onClick={() => go(i + 1)}>Next<ChevronRight className="size-4" /></Button>}
          {(all || i === quiz.questions.length - 1) && <Button variant="accent" icon={Trophy} disabled={!all} loading={busy && all} onClick={finish} title={all ? undefined : 'Answer every question first'}>Finish Quiz</Button>}
        </div>
        {i === quiz.questions.length - 1 && !all && <p className="mt-2 text-right text-xs text-mute">{quiz.questions.length - answered} question(s) still to answer.</p>}
      </Card>
      {confirmNode}
    </div>
  )
}

/** The pop-up right after Finish Quiz. */
export function ScorePopup({ attempt, onClose }: { attempt: QuizAttempt | null; onClose: () => void }) {
  if (!attempt) return null
  const f = quizFeedback(attempt.score ?? 0, attempt.total)
  const look = { party: ['🎉🏆🎉', 'from-amber-400 to-pink-500'], great: ['🌟', 'from-emerald-500 to-teal-500'], good: ['👏', 'from-sky-500 to-indigo-500'], ok: ['💪', 'from-amber-500 to-orange-500'], low: ['📘', 'from-slate-500 to-slate-700'] }[f.tone]
  return (
    <Modal open onClose={onClose} title="Quiz finished" size="sm" footer={<Button onClick={onClose}>See my answers</Button>}>
      <div className="text-center">
        <div className={cx('mx-auto grid size-28 place-items-center rounded-full bg-gradient-to-br text-white shadow-lg', look[1])}>
          <span className="text-4xl font-extrabold tabular-nums">{attempt.score}<span className="text-lg font-bold opacity-80">/{attempt.total}</span></span>
        </div>
        <p className={cx('mt-3 text-3xl', f.tone === 'party' && 'anim-pulse-soft')} aria-hidden>{look[0]}</p>
        <p className="mt-1 text-lg font-extrabold">{f.title}</p>
        <p className="mt-1 text-sm text-mute">{attempt.correct} correct · {attempt.incorrect} incorrect · {attempt.quizName}</p>
      </div>
    </Modal>
  )
}

/** Every question: the answer given, the right answer, correct / incorrect. */
function QuizReview({ attempt, who, onBack }: { attempt: QuizAttempt; who: string; onBack?: () => void }) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          {onBack && <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack}>Back</Button>}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-extrabold">{attempt.quizName}</h2>
            <p className="text-xs text-mute">Quiz ID {attempt.quizId} · {who} · completed {fmtDateTime(attempt.finishedAt)}</p>
          </div>
          <Badge tone={scoreTone(attempt.score ?? 0)} className="text-sm">Score {attempt.score}/{attempt.total}</Badge>
          <Badge tone="green">{attempt.correct} correct</Badge>
          <Badge tone="red">{attempt.incorrect} incorrect</Badge>
        </div>
      </Card>
      {(attempt.review ?? []).map((r, n) => (
        <Card key={r.id} className={cx('border-l-4 p-4', r.ok ? 'border-l-ok' : 'border-l-bad')}>
          <div className="flex items-start gap-3">
            <span className="text-xs font-bold text-mute">Q{n + 1}</span>
            <p className="flex-1 text-sm font-semibold">{r.text}</p>
            <Badge tone={r.ok ? 'green' : 'red'}>{r.ok ? 'Correct' : 'Incorrect'}</Badge>
          </div>
          <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {r.options.map((o, i) => {
              const right = i === r.correct, mine = i === r.choice
              return (
                <li key={i} className={cx('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm', right ? 'border-ok/40 bg-ok-soft' : mine ? 'border-bad/40 bg-bad-soft' : 'border-line')}>
                  {right ? <CheckCircle2 className="size-4 shrink-0 text-ok" /> : mine ? <XCircle className="size-4 shrink-0 text-bad" /> : <CircleDashed className="size-4 shrink-0 text-mute/60" />}
                  <span className="flex-1">{o}</span>
                  {mine && <span className="text-[10px] font-bold uppercase text-mute">your answer</span>}
                  {right && !mine && <span className="text-[10px] font-bold uppercase text-ok">correct</span>}
                </li>
              )
            })}
          </ul>
        </Card>
      ))}
    </div>
  )
}

function AttemptsTable({ title, attempts, onOpen, showPerson }: { title: string; attempts: QuizAttempt[]; onOpen: (a: QuizAttempt) => void; showPerson?: boolean }) {
  const db = useDb()
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} subtitle={`${attempts.length} completed`} icon={Trophy} />
      {!attempts.length ? <EmptyState icon={Trophy} title="No results yet" /> : (
        <Table>
          <thead><tr><Th>Quiz</Th>{showPerson && <Th>Sales person</Th>}<Th>Completed</Th><Th className="text-right">Score</Th><Th className="text-right">Correct</Th><Th className="text-right">Incorrect</Th><Th className="text-right" /></tr></thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.id}>
                <Td><b className="block text-[13px]">{a.quizName}</b><span className="font-mono text-[11px] text-mute">{a.quizId}</span></Td>
                {showPerson && <Td className="text-[13px]">{userName(db, a.userId)}</Td>}
                <Td className="whitespace-nowrap text-xs">{a.finishedAt ? fmtDateTime(a.finishedAt) : <Badge tone="amber">In progress · {Object.keys(a.answers).length}/{a.total}</Badge>}</Td>
                <Td className="text-right">{a.finishedAt ? <Badge tone={scoreTone(a.score ?? 0)}>{a.score}/{a.total}</Badge> : '—'}</Td>
                <Td className="text-right tabular-nums text-ok">{a.correct ?? '—'}</Td>
                <Td className="text-right tabular-nums text-bad">{a.incorrect ?? '—'}</Td>
                <Td className="text-right">{a.finishedAt && <Button size="sm" variant="ghost" icon={Eye} onClick={() => onOpen(a)}>Review</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

/** Sales dashboard: Start Quiz when a quiz is open, and the latest score. */
export function QuizDashboardCard() {
  const me = useMe()
  const load = useCallback(() => loadMyQuizzes(me), [me])
  const { data } = useQuizData(load, canTakeQuiz(me))
  if (!canTakeQuiz(me) || !data) return null
  const pending = data.quizzes.find((q) => !data.attempts.some((a) => a.quizId === q.id && a.finishedAt))
  const last = data.attempts.find((a) => a.finishedAt)
  if (!pending && !last) return null
  const inProgress = pending && data.attempts.find((a) => a.quizId === pending.id)
  return (
    <Card className="mb-5 flex flex-wrap items-center gap-4 border-accent/30 p-4">
      <span className="grid size-11 place-items-center rounded-lg bg-accent-soft text-accent"><GraduationCap className="size-6" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-mute">Sales Quiz</p>
        <p className="truncate font-bold">{pending ? `${pending.name} · ${pending.questions.length} questions` : 'No new quiz right now'}</p>
        {last && <p className="text-xs text-mute">Last result: <b className={cx(scoreTone(last.score ?? 0) === 'green' ? 'text-ok' : scoreTone(last.score ?? 0) === 'amber' ? 'text-warn' : 'text-bad')}>{last.score}/{last.total}</b> in {last.quizName} · {fmtDateTime(last.finishedAt)}</p>}
      </div>
      {last && <Link to={`/quiz?review=${last.id}`}><Button variant="outline" icon={Eye}>My results</Button></Link>}
      {pending && <Link to={`/quiz?play=${pending.id}`}><Button variant="accent" icon={Play}>{inProgress ? 'Continue Quiz' : 'Start Quiz'}</Button></Link>}
    </Card>
  )
}

// ============================================================ IT Support: quizzes
const blankQuestion = (): QuizQuestion => ({ id: newQuestionId(), text: '', options: ['', '', '', ''], correct: -1 })
const blankQuiz = (): Quiz => ({ id: `quiz-${Date.now().toString(36)}`, name: '', description: '', status: 'DRAFT', questions: Array.from({ length: QUIZ_SIZE }, blankQuestion), createdAt: '' })
const STATUS: Record<QuizStatus, { label: string; tone: 'gray' | 'green' | 'amber' }> = { DRAFT: { label: 'Draft', tone: 'gray' }, PUBLISHED: { label: 'Published', tone: 'green' }, ARCHIVED: { label: 'Archived', tone: 'amber' } }

function QuizManagement() {
  const me = useMe()
  const run = useRun()
  const [confirm, confirmNode] = useConfirm()
  const load = useCallback(() => loadQuizAdmin(me), [me])
  const { data, error, reload } = useQuizData(load)
  const [edit, setEdit] = useState<Quiz | null>(null)
  const takenBy = (id: string) => (data?.attempts ?? []).filter((a) => a.quizId === id)
  const act = async (fn: () => Promise<unknown>, ok: string) => { if (await run(fn, ok)) reload() }
  return (
    <div className="space-y-5">
      {error && <Card className="p-4 text-sm text-bad">{error}</Card>}
      <Card className="overflow-hidden">
        <CardHeader title="Quizzes" subtitle="Draft → Publish (open for Sales) → Archive (closed, results kept). A quiz someone has taken keeps its questions." icon={GraduationCap}
          action={<Button icon={Plus} onClick={() => setEdit(blankQuiz())}>New quiz</Button>} />
        {!data?.quizzes.length ? <EmptyState icon={GraduationCap} title="No quizzes yet" text="Make the first one: 10 questions, the options and the correct answer for each." /> : (
          <Table>
            <thead><tr><Th>Quiz</Th><Th>Status</Th><Th className="text-right">Questions</Th><Th className="text-right">Taken</Th><Th className="text-right">Average</Th><Th>Updated</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {data.quizzes.map((q) => {
                const t = takenBy(q.id), done = t.filter((a) => a.finishedAt)
                const avg = done.length ? done.reduce((s, a) => s + (a.score ?? 0), 0) / done.length : null
                return (
                  <tr key={q.id}>
                    <Td><b className="block text-[13px]">{q.name}</b><span className="font-mono text-[11px] text-mute">{q.id}</span></Td>
                    <Td><Badge tone={STATUS[q.status].tone}>{STATUS[q.status].label}</Badge></Td>
                    <Td className="text-right tabular-nums">{q.questions.length}/{QUIZ_SIZE}</Td>
                    <Td className="text-right tabular-nums">{done.length}{t.length > done.length ? <span className="text-xs text-mute"> +{t.length - done.length} in progress</span> : ''}</Td>
                    <Td className="text-right tabular-nums">{avg == null ? '—' : `${avg.toFixed(1)}/10`}</Td>
                    <Td className="whitespace-nowrap text-xs text-mute">{fmtDateTime(q.updatedAt ?? q.createdAt)}</Td>
                    <Td className="text-right"><span className="inline-flex flex-wrap justify-end gap-1">
                      {t.length ? <Button size="sm" variant="ghost" icon={Eye} onClick={() => setEdit(q)}>View</Button> : <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(q)}>Edit</Button>}
                      <Button size="sm" variant="ghost" icon={Copy} aria-label="Copy into a new quiz" title="Copy into a new quiz" onClick={() => setEdit({ ...structuredClone(q), id: `quiz-${Date.now().toString(36)}`, name: `${q.name} (copy)`, status: 'DRAFT', createdAt: '', publishedAt: undefined, updatedAt: undefined, questions: q.questions.map((x) => ({ ...x, id: newQuestionId() })) })} />
                      {q.status !== 'PUBLISHED' && <Button size="sm" variant="soft" icon={Rocket} onClick={() => act(() => setQuizStatus(me, q, 'PUBLISHED', !!t.length), 'Published for the Sales team')}>Publish</Button>}
                      {q.status === 'PUBLISHED' && !t.length && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => act(() => setQuizStatus(me, q, 'DRAFT', false), 'Back to draft')}>Unpublish</Button>}
                      {q.status === 'PUBLISHED' && t.length > 0 && <Button size="sm" variant="ghost" icon={Archive} onClick={async () => { if (await confirm(`Archive “${q.name}”?`, 'It closes for Sales; people who have not finished it can no longer. Every result stays.')) act(() => setQuizStatus(me, q, 'ARCHIVED', true), 'Archived') }}>Archive</Button>}
                      {!t.length && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${q.name}`} className="text-bad" onClick={async () => { if (await confirm(`Delete “${q.name}”?`, 'Nobody has taken it, so nothing else is lost.', true)) act(() => deleteQuiz(me, q, false), 'Quiz deleted') }} />}
                    </span></Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {edit && <QuizEditor initial={edit} readOnly={takenBy(edit.id).length > 0} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
      {confirmNode}
    </div>
  )
}

function QuizEditor({ initial, readOnly, onClose, onSaved }: { initial: Quiz; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const me = useMe()
  const run = useRun()
  const [q, setQ] = useState<Quiz>(() => structuredClone(initial))
  const [busy, setBusy] = useState(false)
  const setQuestion = (n: number, patch: Partial<QuizQuestion>) => setQ((x) => ({ ...x, questions: x.questions.map((y, i) => (i === n ? { ...y, ...patch } : y)) }))
  const problem = quizProblem(q, { publish: true })
  const save = async (publish: boolean) => {
    setBusy(true)
    const ok = await run(() => saveQuiz(me, q, publish), publish ? 'Saved and published for the Sales team' : 'Draft saved')
    setBusy(false)
    if (ok) onSaved()
  }
  const complete = q.questions.filter((x) => x.text.trim().length >= 3 && x.options.every((o) => o.trim()) && x.correct >= 0 && x.correct < x.options.length).length
  return (
    <Modal open onClose={onClose} size="xl" title={readOnly ? q.name : initial.createdAt ? `Edit · ${initial.name}` : 'New quiz'}
      subtitle={readOnly ? 'Sales people have taken this quiz, so its questions stay as they were. Copy it to make a new version.' : `${complete} of ${QUIZ_SIZE} questions complete · mark the correct answer of each with the round button`}
      footer={readOnly ? <Button onClick={onClose}>Close</Button> : <>
        {problem && <span className="mr-auto self-center text-xs text-warn">{problem}</span>}
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="outline" icon={Save} loading={busy} disabled={q.status === 'PUBLISHED'} title={q.status === 'PUBLISHED' ? 'A published quiz saves as published' : undefined} onClick={() => save(false)}>Save draft</Button>
        <Button icon={Rocket} loading={busy} disabled={!!problem} onClick={() => save(true)}>{q.status === 'PUBLISHED' ? 'Save' : 'Save & publish'}</Button>
      </>}>
      <fieldset disabled={readOnly} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Input label="Quiz name" required value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} placeholder="e.g. Government schemes · Week 45" />
          <Input label="Short description (optional)" value={q.description ?? ''} onChange={(e) => setQ({ ...q, description: e.target.value })} placeholder="What it covers" />
        </div>
        {q.questions.map((x, n) => (
          <Card key={x.id} className="p-3.5">
            <div className="flex items-start gap-2">
              <span className="mt-2 grid size-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-xs font-bold text-brand-ink">{n + 1}</span>
              <Textarea className="flex-1" rows={2} value={x.text} onChange={(e) => setQuestion(n, { text: e.target.value })} placeholder={`Question ${n + 1}`} aria-label={`Question ${n + 1}`} />
              {!readOnly && q.questions.length > 1 && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete question ${n + 1}`} className="mt-1 text-bad" onClick={() => setQ({ ...q, questions: q.questions.filter((_, i) => i !== n) })} />}
            </div>
            <div className="mt-2 grid gap-2 pl-9 sm:grid-cols-2">
              {x.options.map((o, i) => (
                <div key={i} className={cx('flex items-center gap-2 rounded-lg border px-2 py-1', x.correct === i ? 'border-ok bg-ok-soft' : 'border-line')}>
                  <input type="radio" name={`correct-${x.id}`} checked={x.correct === i} onChange={() => setQuestion(n, { correct: i })} aria-label={`Option ${String.fromCharCode(65 + i)} is correct`} className="size-4 accent-[var(--ok)]" />
                  <span className="text-xs font-bold text-mute">{String.fromCharCode(65 + i)}</span>
                  <input value={o} onChange={(e) => setQuestion(n, { options: x.options.map((y, k) => (k === i ? e.target.value : y)) })} placeholder={`Option ${String.fromCharCode(65 + i)}`}
                    className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label={`Question ${n + 1} option ${String.fromCharCode(65 + i)}`} />
                  {!readOnly && x.options.length > MIN_OPTIONS && <button type="button" aria-label="Remove option" onClick={() => setQuestion(n, { options: x.options.filter((_, k) => k !== i), correct: x.correct === i ? -1 : x.correct > i ? x.correct - 1 : x.correct })} className="text-mute hover:text-bad"><XCircle className="size-4" /></button>}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3 pl-9 text-xs">
              {!readOnly && x.options.length < MAX_OPTIONS && <button type="button" onClick={() => setQuestion(n, { options: [...x.options, ''] })} className="font-semibold text-brand-ink hover:underline">+ Add option</button>}
              <span className={x.correct >= 0 ? 'text-ok' : 'text-warn'}>{x.correct >= 0 ? `Correct answer: ${String.fromCharCode(65 + x.correct)}` : 'Mark the correct answer'}</span>
            </div>
          </Card>
        ))}
        {!readOnly && q.questions.length < QUIZ_SIZE && <Button variant="outline" icon={Plus} onClick={() => setQ({ ...q, questions: [...q.questions, blankQuestion()] })}>Add question ({q.questions.length}/{QUIZ_SIZE})</Button>}
      </fieldset>
    </Modal>
  )
}

// ============================================================ IT Support: every result
function QuizResults() {
  const me = useMe()
  const db = useDb()
  const load = useCallback(() => loadQuizAdmin(me), [me])
  const { data, error, reload } = useQuizData(load)
  const [quizId, setQuizId] = useState('')
  const [person, setPerson] = useState('')
  const [open, setOpen] = useState<QuizAttempt | null>(null)
  const rows = useMemo(() => (data?.attempts ?? []).filter((a) => (!quizId || a.quizId === quizId) && (!person || a.userId === person))
    .sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt)), [data, quizId, person])
  const done = rows.filter((a) => a.finishedAt)
  const avg = done.length ? done.reduce((s, a) => s + (a.score ?? 0), 0) / done.length : 0
  const people = [...new Set((data?.attempts ?? []).map((a) => a.userId))]
  // per person: how many quizzes and their average
  const board = useMemo(() => {
    const m = new Map<string, { n: number; sum: number; best: number }>()
    for (const a of done) { const x = m.get(a.userId) ?? { n: 0, sum: 0, best: 0 }; x.n++; x.sum += a.score ?? 0; x.best = Math.max(x.best, a.score ?? 0); m.set(a.userId, x) }
    return [...m.entries()].map(([id, x]) => ({ id, ...x, avg: x.sum / x.n })).sort((a, b) => b.avg - a.avg)
  }, [done])
  const exportCsv = () => downloadCsv(`quiz-results-${new Date().toISOString().slice(0, 10)}.csv`, done.map((a) => ({
    Quiz: a.quizName, 'Quiz ID': a.quizId, 'Sales person': userName(db, a.userId), Completed: fmtDateTime(a.finishedAt), Score: `${a.score}/${a.total}`, Correct: a.correct, Incorrect: a.incorrect,
  })))
  if (open) return <QuizReview attempt={open} who={userName(db, open.userId)} onBack={() => setOpen(null)} />
  return (
    <div className="space-y-5">
      {error && <Card className="p-4 text-sm text-bad">{error}</Card>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-3.5"><p className="text-xs text-mute">Completed</p><p className="text-xl font-extrabold tabular-nums">{done.length}</p></Card>
        <Card className="p-3.5"><p className="text-xs text-mute">In progress</p><p className="text-xl font-extrabold tabular-nums">{rows.length - done.length}</p></Card>
        <Card className="p-3.5"><p className="text-xs text-mute">Average score</p><p className="text-xl font-extrabold tabular-nums">{done.length ? `${avg.toFixed(1)}/10` : '—'}</p></Card>
        <Card className="p-3.5"><p className="text-xs text-mute">Perfect 10s</p><p className="text-xl font-extrabold tabular-nums text-ok">{done.filter((a) => a.score === a.total).length}</p></Card>
      </div>
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Select label="Quiz" value={quizId} onChange={(e) => setQuizId(e.target.value)} className="min-w-56"><option value="">All quizzes</option>{(data?.quizzes ?? []).map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</Select>
        <Select label="Sales person" value={person} onChange={(e) => setPerson(e.target.value)} className="min-w-56"><option value="">Everyone</option>{people.map((id) => <option key={id} value={id}>{userName(db, id)}</option>)}</Select>
        <span className="flex-1" />
        <Button variant="ghost" icon={RefreshCcw} aria-label="Refresh" onClick={reload} />
        <Button variant="outline" icon={Download} disabled={!done.length} onClick={exportCsv}>Export CSV</Button>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <AttemptsTable title="Results" attempts={rows} onOpen={setOpen} showPerson />
        <Card className="overflow-hidden">
          <CardHeader title="Sales team performance" subtitle="Average of completed quizzes" icon={BarChart3} />
          {!board.length ? <EmptyState icon={BarChart3} title="No results yet" /> : (
            <ul className="divide-y divide-line/70">
              {board.map((b, n) => (
                <li key={b.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-5 text-xs font-bold text-mute">{n + 1}</span>
                  <span className="min-w-0 flex-1"><b className="block truncate">{userName(db, b.id)}</b><span className="text-xs text-mute">{b.n} quiz(zes) · best {b.best}/10</span></span>
                  <Badge tone={scoreTone(Math.round(b.avg))}>{b.avg.toFixed(1)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
