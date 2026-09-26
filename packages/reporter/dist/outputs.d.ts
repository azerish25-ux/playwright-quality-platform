import { type MergedRunResult } from '@azerish25-ux/forgeqa-core';
export declare function toJsonReport(run: MergedRunResult): string;
export declare function toJUnit(run: MergedRunResult): string;
export declare function toMarkdownSummary(run: MergedRunResult): string;
export declare function toHtmlReport(run: MergedRunResult): string;
export declare function reportChecksums(outputs: Record<string, string>): Record<string, string>;
//# sourceMappingURL=outputs.d.ts.map