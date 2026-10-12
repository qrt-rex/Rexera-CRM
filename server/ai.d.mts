export interface AiMessage { role: 'user' | 'assistant'; content: string }
export interface AiRequest { messages: AiMessage[]; context: string }
export declare const AI_LIMITS: { messages: number; messageChars: number; contextChars: number; replyTokens: number }
export declare function checkAiRequest(p: unknown): string | null
export declare function aiOverLimit(ip: string, limits?: { hourly?: number; daily?: number }): string | null
export declare function aiConfig(get: (key: string) => string | undefined): { apiKey: string; baseUrl: string; model: string }
export declare function answerAi(p: { messages: { role: string; content: string }[]; context: string }, opts: { apiKey?: string; model?: string; baseUrl?: string }): Promise<{ status: number; body: { success: boolean; reply?: string; message?: string; configured?: boolean; model?: string } }>
