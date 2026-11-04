import assert from 'node:assert/strict'
import { QUIZ_SIZE, fmtClock, publicQuestions, quizFeedback, quizProblem, scoreQuiz, secondsLeft, windowProblem, windowState } from './quiz-rules.mjs'

const q = (i, correct = 1) => ({ id: `q${i}`, text: `Question ${i}?`, options: ['A', 'B', 'C', 'D'], correct })
const ten = Array.from({ length: QUIZ_SIZE }, (_, i) => q(i + 1))

assert.equal(quizProblem({ name: 'Week 1', questions: ten }, { publish: true }), null)
assert.equal(quizProblem({ name: 'Week 1', questions: ten.slice(0, 3) }), null, 'a draft may be part-done')
assert.match(quizProblem({ name: 'Week 1', questions: ten.slice(0, 3) }, { publish: true }), /all 10/)
assert.match(quizProblem({ name: 'x', questions: ten }), /name/)
assert.match(quizProblem({ name: 'Week 1', questions: [...ten, q(11)] }), /10 questions/)
assert.match(quizProblem({ name: 'Week 1', questions: [{ ...q(1), options: ['A'] }] }), /2–6/)
assert.match(quizProblem({ name: 'Week 1', questions: [{ ...q(1), options: ['A', 'a'] }] }), /same/)
assert.match(quizProblem({ name: 'Week 1', questions: [{ ...q(1), correct: 9 }] }), /correct answer/)
assert.match(quizProblem({ name: 'Week 1', questions: [q(1), q(1)] }), /id/)

assert.deepEqual(Object.keys(publicQuestions(ten)[0]).sort(), ['id', 'options', 'text'], 'no correct answers for Sales')

const answers = Object.fromEntries(ten.map((x, i) => [x.id, { choice: i < 7 ? 1 : 0 }]))
const r = scoreQuiz(ten, answers)
assert.equal(r.score, 7); assert.equal(r.correct, 7); assert.equal(r.incorrect, 3)
assert.equal(r.review[7].ok, false); assert.equal(r.review[7].choice, 0); assert.equal(r.review[7].correct, 1)
assert.equal(scoreQuiz(ten, {}).score, 0, 'unanswered = incorrect')

assert.match(quizFeedback(10).title, /Party Time/)
assert.equal(quizFeedback(9).title, 'Very Good!')
assert.equal(quizFeedback(8).title, 'Nice Work!')
assert.match(quizFeedback(5).title, /Good Effort/)
assert.match(quizFeedback(7).title, /Good Effort/)
assert.match(quizFeedback(4).title, /Please Improve/)
assert.match(quizFeedback(0).title, /Please Improve/)

// quiz time, India time (UTC+5:30): 9:15–9:30 am IST = 03:45–04:00 UTC
const at = (utc) => Date.parse(`2026-11-04T${utc}Z`)
assert.equal(windowState('09:15', '09:30', at('03:44:59')), 'before')
assert.equal(windowState('09:15', '09:30', at('03:45:00')), 'open')
assert.equal(windowState('09:15', '09:30', at('03:59:59')), 'open')
assert.equal(windowState('09:15', '09:30', at('04:00:00')), 'after')
assert.equal(secondsLeft('09:30', at('03:58:30')), 90)
assert.equal(secondsLeft('09:30', at('04:10:00')), 0)
assert.equal(windowProblem('09:15', '09:30'), null)
assert.match(windowProblem('09:30', '09:15'), /after it starts/)
assert.match(windowProblem('9:15', '09:30'), /HH:MM/)
assert.equal(fmtClock('09:15'), '9:15 am'); assert.equal(fmtClock('13:05'), '1:05 pm'); assert.equal(fmtClock('00:30'), '12:30 am')

console.log('✓ quiz: 10 questions, options, correct answer, no answers for Sales, score, feedback, daily quiz time')
