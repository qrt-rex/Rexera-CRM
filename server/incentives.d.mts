export interface ReportConfig { url: string; key: string }
export declare function reportConfig(get: (key: string) => string | undefined): ReportConfig
export declare function incentiveReport(query: URLSearchParams, cfg: ReportConfig): Promise<{ status: number; body: { success: boolean; code?: string; message?: string; data?: unknown } }>
