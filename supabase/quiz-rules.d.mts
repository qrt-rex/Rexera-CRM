export interface QuizQuestion { id: string; text: string; options: string[]; correct: number }
export interface PublicQuestion { id: string; text: string; options: string[] }
export interface ReviewRow { id: string; text: string; options: string[]; correct: number; choice: number | null; ok: boolean }
export const QUIZ_SIZE: number
export const MIN_OPTIONS: number
export const MAX_OPTIONS: number
export function quizProblem(q: { name: string; questions: QuizQuestion[] }, opts?: { publish?: boolean }): string | null
export function publicQuestions(questions: QuizQuestion[]): PublicQuestion[]
export function scoreQuiz(questions: QuizQuestion[], answers: Record<string, { choice: number; at?: string }>): { review: ReviewRow[]; correct: number; incorrect: number; score: number }
export function quizFeedback(score: number, total?: number): { title: string; tone: 'party' | 'great' | 'good' | 'ok' | 'low' }
