import type { ResolvedForgeConfig } from '@azerish25-ux/forgeqa-core';
export interface ForgeWorkerContext {
    runId: string;
    namespace: string;
    config: ResolvedForgeConfig;
}
export interface ExtendableTest<TFixtures extends object = object> {
    extend<TAdded extends object>(fixtures: Record<string, unknown>): ExtendableTest<TFixtures & TAdded>;
}
export interface ForgeTestOptions {
    config: ResolvedForgeConfig;
    runId: string;
    namespaceFactory: (workerInfo: {
        project: {
            name: string;
        };
        parallelIndex: number;
        workerIndex: number;
    }) => string;
}
export declare function createForgeTest<T extends object>(base: ExtendableTest<T>, options: ForgeTestOptions): ExtendableTest<T & {
    forge: ForgeWorkerContext;
}>;
export declare function forgeId(id: string): {
    type: 'forgeqa-id';
    description: string;
};
export declare function forgeOwner(owner: string): {
    type: 'forgeqa-owner';
    description: string;
};
export interface PlaywrightReporterLike {
    onBegin?(config: unknown, suite: unknown): void;
    onTestBegin?(test: unknown, result: unknown): void;
    onTestEnd?(test: unknown, result: unknown): void;
    onEnd?(result: unknown): Promise<void> | void;
}
export declare function playwrightReporter(configPath?: string): {
    new (options?: Record<string, unknown>): PlaywrightReporterLike;
};
//# sourceMappingURL=index.d.ts.map