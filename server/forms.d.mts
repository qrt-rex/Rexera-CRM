type Answer = { status: number; body: unknown }
export function getPublicForm(env: (k: string) => string, token: string, mobile: string | null, ip: string): Promise<Answer>
export function submitPublicForm(env: (k: string) => string, token: string, raw: string, ip: string): Promise<Answer>
