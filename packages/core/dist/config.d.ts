export type BrowserName = 'chromium' | 'firefox' | 'webkit';
export interface ForgeEnvironment {
    baseUrl: string;
    variables?: Record<string, string>;
}
export interface ForgeQualityGates {
    failOnRetryRecovered?: boolean;
    unexpectedSkipBudget?: number;
    maxQuarantineEntries?: number;
    requireCompleteShards?: boolean;
    durationBudgetMs?: number;
    minimumHistorySamples?: number;
    maxFlakeRate?: number;
}
export interface ForgeConfigInput {
    project: string;
    consumer?: string;
    environment?: string;
    environments: Record<string, ForgeEnvironment>;
    suites?: Record<string, string[]>;
    browsers?: BrowserName[];
    workers?: number;
    shards?: number;
    retries?: number;
    timeout?: string | number;
    outputDir?: string;
    historyDir?: string;
    quarantineFile?: string;
    qualityGates?: ForgeQualityGates;
    selectionMap?: Record<string, string[]>;
    artifactPolicy?: {
        trace?: string;
        screenshot?: string;
        video?: string;
        retentionDays?: number;
    };
    github?: {
        summary?: boolean;
        prComment?: boolean;
    };
}
export interface ResolveConfigOptions {
    cwd?: string;
    environment?: string;
    env?: Record<string, string | undefined>;
    cli?: Partial<Pick<ForgeConfigInput, 'workers' | 'shards' | 'retries' | 'timeout' | 'browsers' | 'outputDir'>>;
}
export interface ResolvedForgeConfig extends Omit<ForgeConfigInput, 'timeout' | 'environment'> {
    environment: string;
    timeoutMs: number;
    baseUrl: string;
    outputDir: string;
    historyDir: string;
    quarantineFile: string;
    configHash: string;
    redacted: Record<string, unknown>;
}
export declare function defineForgeConfig(input: ForgeConfigInput): ForgeConfigInput;
export declare function parseDuration(value: string | number): number;
export declare function resolveForgeConfig(input: ForgeConfigInput, options?: ResolveConfigOptions): ResolvedForgeConfig;
//# sourceMappingURL=config.d.ts.map