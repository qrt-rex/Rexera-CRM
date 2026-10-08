export interface ClientEmailStep { label: string; state: 'done' | 'current' | 'todo' }
export interface ClientEmailSender { name: string; role?: string; phone?: string; email?: string }
export interface ClientEmailRequest {
  to: string
  cc?: string[]
  replyTo?: string
  subject: string
  /** big title inside the email (defaults to the subject) */
  heading?: string
  /** plain text: blank lines split paragraphs, lines starting with • - * become bullets */
  message: string
  details?: [string, string][]
  steps?: ClientEmailStep[]
  sender: ClientEmailSender
  company?: string
}
export declare const CLIENT_EMAIL_LIMITS: { subject: number; message: number; details: number; cc: number; steps: number }
export declare function checkClientEmail(p: unknown): string | null
export declare function renderClientEmail(p: ClientEmailRequest): { html: string; text: string }
