export interface PollOptions<T> {
    operation: () => Promise<T>;
    until: (value: T) => boolean;
    timeoutMs: number;
    intervalMs?: number;
    signal?: AbortSignal;
    describe?: string;
}
export declare function pollUntil<T>(options: PollOptions<T>): Promise<T>;
//# sourceMappingURL=poll.d.ts.map