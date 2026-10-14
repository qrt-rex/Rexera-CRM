export declare function setPassword(env: (key: string) => string | undefined, authorization: string | undefined, body: unknown): Promise<{ status: number; body: { success: boolean; message?: string } }>
export declare function crmUser(env: (key: string) => string | undefined, authorization: string | undefined): Promise<{ id: string; email: string; roles: string[] } | null>
