export interface QuizQuestion { id: string; text: string; options: string[]; correct: number }
export interface PublicQuestion { id: string; text: string; options: string[] }
export interface ReviewRow { id: string; text: string; options: string[]; correct: number; choice: number | null; ok: boolean }
export const QUIZ_SIZE: number
export const MIN_OPTIONS: number
export const MAX_OPTIONS: number
export function quizProblem(q: { name: string; questions: QuizQuestion[] }, opts?: { publish?: boolean }): string | null
export function publicQuestions(questions: QuizQuestion[]): PublicQuestion[]
export function scoreQuiz(questions: QuizQuestion[], answers: Record<string, { choice: number; at?: string }>): { review: ReviewRow[]; correct: number; incorrect: number; score: number }
export const DEFAULT_WINDOW: { start: string; end: string }
export function windowProblem(start: string, end: string): string | null
export function istClock(now?: number): string
export function windowState(start?: string, end?: string, now?: number): 'before' | 'open' | 'after'
export function secondsLeft(end?: string, now?: number): number
export function fmtClock(hhmm: string): string
export function quizFeedback(score: number, total?: number): { title: string; tone: 'party' | 'great' | 'good' | 'ok' | 'low' }
