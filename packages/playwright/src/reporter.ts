import type { FullConfig, Suite, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import { TimingRecorder } from '@azerish25-ux/forgeqa-core';
import BaseReporter from './base-reporter.js';

/** Optional sidecar instrumentation; the canonical reporter still owns every outcome. */
export default class ForgeReporter extends BaseReporter {
  private timing?: TimingRecorder;
  private timingFailed = false;
  private firstTest?: number;
  private lastTest?: number;
  private finalizationStart?: number;
  private attemptWork = 0;
  private attemptCount = 0;
  private cleanEnd = false;

  private observe(fn: () => void): void {
    try { fn(); } catch {
      this.timingFailed = true;
      process.exitCode = 3;
      process.stderr.write('FORGEQA_TIMING: incomplete profiling evidence.\n');
    }
  }
  override onBegin(config: FullConfig, suite: Suite): void {
    super.onBegin(config, suite);
    const metadata = config.metadata['forgeqa'] as { mode?: string; runId: string } | undefined;
    const path = process.env.FORGEQA_TIMING_CONTEXT;
    if (!path || metadata?.mode !== 'run') return;
    this.observe(() => {
      this.timing = new TimingRecorder(path, 'reporter', {
        sourceSha: process.env.FORGEQA_SOURCE_SHA ?? '', runId: metadata.runId,
        shardIndex: config.shard?.current ?? 1, shardTotal: config.shard?.total ?? 1
      });
    });
  }
  onTestBegin(_test: TestCase, _result: TestResult): void {
    if (this.timing) this.observe(() => { this.firstTest ??= this.timing!.now(); });
  }
  override onTestEnd(test: TestCase, result: TestResult): void {
    if (this.timing) this.observe(() => {
      this.lastTest = this.timing!.now();
      this.attemptWork += result.duration;
      this.attemptCount += 1;
    });
    super.onTestEnd(test, result);
  }
  override async onEnd(result: FullResult): Promise<{status: 'passed' | 'failed'}> {
    if (this.timing) this.observe(() => { this.finalizationStart = this.timing!.now(); });
    const outcome = await super.onEnd(result);
    this.cleanEnd = outcome.status === 'passed' && result.status === 'passed';
    if (this.timing) this.observe(() => {
      const end = this.timing!.now();
      if (this.firstTest !== undefined && this.lastTest !== undefined) this.timing!.span('testWindow', this.firstTest, this.lastTest);
      this.timing!.span('forgeqaFinalization', this.finalizationStart!, end);
      this.timing!.counter('attemptWorkMs', this.attemptWork);
      this.timing!.counter('attempts', this.attemptCount);
    });
    return this.timingFailed ? { status: 'failed' } : outcome;
  }
  onExit(): void {
    if (!this.timing) return;
    this.observe(() => {
      // Playwright calls onExit after all onEnd callbacks, including its blob writer.
      if (this.finalizationStart !== undefined) this.timing!.span('allReportersFinalization', this.finalizationStart);
      this.timing!.finish(this.cleanEnd && !this.timingFailed && this.attemptCount > 0);
    });
  }
}
