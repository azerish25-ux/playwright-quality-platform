import { type ActionEnvironment } from './input.js';
type ActionMode = 'run' | 'plan' | 'merge';
type PackageManager = 'auto' | 'npm' | 'pnpm' | 'none';
type BrowserInstall = 'none' | 'install' | 'with-deps';
type ReportingMode = 'summary' | 'none';
export type ActionOutcome = 'success' | 'quality-failure' | 'infrastructure-failure' | 'interrupted';
export interface ForgeActionInputs {
    mode: ActionMode;
    suite: string;
    browsers: string[];
    environment: string;
    workingDirectory: string;
    config: string;
    playwrightConfig: string;
    packageManager: PackageManager;
    installDependencies: boolean;
    browserInstall: BrowserInstall;
    buildCommand: string;
    applicationCommand: string;
    readinessUrl: string;
    readinessTimeoutSeconds: number;
    workers: number;
    shardCount: number;
    shardIndex?: number;
    maxLocalShards: number;
    manifest: string;
    evidenceDirectory: string;
    outputDirectory: string;
    cliPath: string;
    artifactRetentionDays: number;
    reportingMode: ReportingMode;
}
export interface ForgeActionResult {
    exitCode: number;
    outcome: ActionOutcome;
    mode: ActionMode;
    runId: string;
    testCount: number;
    attemptCount: number;
    flakyCount: number;
    shardCount: number;
    shardIndex?: number;
    manifestPath: string;
    evidencePath: string;
    reportPath: string;
    artifactName: string;
    runUrl: string;
    error?: string;
}
export declare function parseActionInputs(env?: ActionEnvironment): ForgeActionInputs;
export declare function classifyOutcome(code: number): ActionOutcome;
export declare function resolveWorkingDirectory(workspace: string, requested: string): Promise<string>;
export declare function validateReadinessUrl(value: string): URL;
export declare function executeAction(env?: ActionEnvironment): Promise<ForgeActionResult>;
export declare function main(): Promise<void>;
export {};
//# sourceMappingURL=main.d.ts.map