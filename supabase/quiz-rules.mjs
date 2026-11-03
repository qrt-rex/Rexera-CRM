/**
 * Sales Quiz rules, shared by the CRM (browser) and its checks. The database applies the same rules in its own
 * functions (supabase/migrations/20261105000000_quiz.sql): a quiz has 10 questions, each 2–6 options and one correct
 * answer; a submitted answer is locked; the score is worked out from IT Support's correct answers.
 */
export const QUIZ_SIZE = 10
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 6

/** What is wrong with a quiz before it can be saved (draft) or published (null = fine). */
export function quizProblem(q, { publish = false } = {}) {
  const name = String(q?.name ?? '').trim()
  if (name.length < 2 || name.length > 120) return 'Give the quiz a name (2–120 characters).'
  const qs = Array.isArray(q?.questions) ? q.questions : []
  if (qs.length > QUIZ_SIZE) return `A quiz has ${QUIZ_SIZE} questions.`
  if (publish && qs.length !== QUIZ_SIZE) return `Add all ${QUIZ_SIZE} questions before publishing (${qs.length} so far).`
  const ids = new Set()
  for (const [i, x] of qs.entries()) {
    const n = i + 1
    if (!x?.id || ids.has(x.id)) return `Question ${n}: missing id.`
    ids.add(x.id)
    const text = String(x.text ?? '').trim()
    if (text.length < 3 || text.length > 500) return `Question ${n}: write the question (3–500 characters).`
    const opts = Array.isArray(x.options) ? x.options.map((o) => String(o ?? '').trim()) : []
    if (opts.length < MIN_OPTIONS || opts.length > MAX_OPTIONS) return `Question ${n}: give ${MIN_OPTIONS}–${MAX_OPTIONS} answer options.`
    if (opts.some((o) => !o || o.length > 200)) return `Question ${n}: every option needs text (up to 200 characters).`
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return `Question ${n}: two options are the same.`
    if (!Number.isInteger(x.correct) || x.correct < 0 || x.correct >= opts.length) return `Question ${n}: choose the correct answer.`
  }
  return null
}

/** The questions a Sales person sees: no correct answers. */
export const publicQuestions = (questions) => (questions ?? []).map(({ id, text, options }) => ({ id, text, options }))

/** Score from the saved answers ({ questionId: { choice } }) and IT's correct answers; the review keeps both. */
export function scoreQuiz(questions, answers) {
  const review = (questions ?? []).map((q) => {
    const choice = answers?.[q.id]?.choice
    const ok = Number.isInteger(choice) && choice === q.correct
    return { id: q.id, text: q.text, options: q.options, correct: q.correct, choice: Number.isInteger(choice) ? choice : null, ok }
  })
  const correct = review.filter((r) => r.ok).length
  return { review, correct, incorrect: review.length - correct, score: correct }
}

/** The pop-up after Finish Quiz. */
export function quizFeedback(score, total = QUIZ_SIZE) {
  const s = total === QUIZ_SIZE ? score : Math.round((score / Math.max(1, total)) * QUIZ_SIZE)
  if (s >= 10) return { title: 'Party Time! Excellent Performance!', tone: 'party' }
  if (s === 9) return { title: 'Very Good!', tone: 'great' }
  if (s === 8) return { title: 'Nice Work!', tone: 'good' }
  if (s >= 5) return { title: 'Good Effort! Keep Improving!', tone: 'ok' }
  return { title: 'Please Improve Your Knowledge and Try to Do Better Next Time.', tone: 'low' }
}
