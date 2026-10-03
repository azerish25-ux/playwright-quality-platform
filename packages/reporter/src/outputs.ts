import { sha256, type AttemptRecord, type MergedRunResult } from '@azerish25-ux/forgeqa-core';
import { reportScript, reportStyles } from './html-assets.js';

export interface HistoryReportMetrics {
  N: number;
  F: number;
  I: number;
  P: number;
  retryObservedFlakeRate: number | null;
  firstAttemptFailureRate: number | null;
  persistentFailureRate: number | null;
  retryRecoveryRate: number | null;
  sufficientSamples: boolean;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  failedAttemptDurationMs: number;
  affectedBrowsers: string[];
  affectedEnvironments: string[];
}
export interface HistoryReportTest extends HistoryReportMetrics {
  logicalTestId: string;
  owner: string | null;
  executions: number;
}
export interface HistoryReportView {
  status: 'COMPARABLE' | 'NO_BASELINE' | 'INSUFFICIENT_HISTORY' | 'HISTORY_INCOMPLETE';
  currentRunId: string;
  comparableRuns: number;
  rejectedRuns: Record<string, number>;
  observationWindow: { start: string; end: string };
  metrics: HistoryReportMetrics;
  tests: Record<string, HistoryReportTest>;
  comparison: {
    status: 'COMPARABLE' | 'NO_BASELINE';
    added: string[];
    removed: string[];
    shared: string[];
    currentFailures: string[];
    baselineFailures: string[];
  };
}

function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '�')
    .replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!
    );
}
function md(value: string): string {
  return xml(value)
    .replace(/[`|\r\n]/g, ' ')
    .replace(/@/g, '＠');
}
function percent(value: number | null): string {
  return value === null ? 'insufficient' : `${(value * 100).toFixed(2)}%`;
}
function numberValue(value: number | null): string {
  return value === null ? 'insufficient' : String(value);
}
function historyFor(
  history: HistoryReportView | undefined,
  logicalTestId: string
): HistoryReportTest | undefined {
  return history?.tests[logicalTestId];
}
function historyLine(value: HistoryReportTest | undefined): string {
  if (!value) return 'history: no comparable observations';
  return `history: N=${value.N} F=${value.F} I=${value.I} P=${value.P}; retry-observed=${percent(value.retryObservedFlakeRate)}; persistent=${percent(value.persistentFailureRate)}; owner=${value.owner ?? 'unowned'}`;
}
function rejectedHistory(history: HistoryReportView): string {
  const entries = Object.entries(history.rejectedRuns).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([reason, count]) => `${reason}=${count}`).join(', ') : 'none';
}

export function executions(
  run: MergedRunResult
): Array<{ final: AttemptRecord; attempts: AttemptRecord[]; outcome: string; blocked: boolean }> {
  const map = new Map<string, AttemptRecord[]>();
  for (const attempt of run.attempts)
    map.set(attempt.executionId, [...(map.get(attempt.executionId) ?? []), attempt]);
  return [...map.values()].map((attempts) => {
    attempts.sort((a, b) => a.retry - b.retry);
    const final = attempts[attempts.length - 1]!;
    const flaky =
      final.outcome === 'passed' &&
      attempts.some((attempt) => ['failed', 'timed-out'].includes(attempt.outcome));
    const outcome = flaky ? 'flaky' : final.outcome;
    const blocked =
      ['failed', 'timed-out', 'unexpected-pass', 'cancelled'].includes(outcome) ||
      (run.gate?.violations.some(
        (violation) =>
          violation.severity === 'error' &&
          (violation.affected?.includes(final.executionId) ||
            violation.affected?.includes(final.logicalTestId))
      ) ??
        false) ||
      (flaky && run.gate?.outcome === 'fail');
    return { final, attempts, outcome, blocked };
  });
}

export function toJsonReport(run: MergedRunResult): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}

export function toJUnit(run: MergedRunResult, history?: HistoryReportView): string {
  const all = executions(run);
  const cases = all
    .map((execution) => {
      const attempt = execution.final;
      const historical = historyFor(history, attempt.logicalTestId);
      const attrs = `name="${xml(attempt.title ?? attempt.logicalTestId)}" classname="${xml(attempt.project ?? attempt.executionId)}" time="${(execution.attempts.reduce((sum, value) => sum + value.durationMs, 0) / 1000).toFixed(3)}"`;
      const original = execution.attempts.find((value) => value.error)?.error;
      const diagnostic = [
        ...execution.attempts.map(
          (value) => `attempt ${value.retry}: ${value.outcome}\n${value.error?.message ?? ''}`
        ),
        historyLine(historical)
      ].join('\n');
      const failure = execution.blocked
        ? `<failure message="${xml(original?.message ?? execution.outcome)}" type="${xml(execution.outcome)}">${xml(diagnostic)}</failure>`
        : '';
      const skipped =
        !execution.blocked && ['skipped', 'expected-failure'].includes(execution.outcome)
          ? `<skipped message="${xml(execution.outcome)}"/>`
          : '';
      const properties = historical
        ? `<properties><property name="forgeqa.history.N" value="${historical.N}"/><property name="forgeqa.history.F" value="${historical.F}"/><property name="forgeqa.history.I" value="${historical.I}"/><property name="forgeqa.history.P" value="${historical.P}"/><property name="forgeqa.history.retryObservedFlakeRate" value="${xml(numberValue(historical.retryObservedFlakeRate))}"/><property name="forgeqa.history.persistentFailureRate" value="${xml(numberValue(historical.persistentFailureRate))}"/><property name="forgeqa.history.owner" value="${xml(historical.owner ?? 'unowned')}"/></properties>`
        : '';
      return `<testcase ${attrs}>${properties}${failure}${skipped}<system-out>${xml(diagnostic)}</system-out></testcase>`;
    })
    .join('');
  const violations =
    run.gate?.violations.map((violation) => `${violation.id}: ${violation.message}`).join('\n') ?? '';
  const evidence = run.evidence?.reconciliation.status ?? 'not-available';
  const historyProperties = history
    ? `<property name="forgeqa.history.status" value="${xml(history.status)}"/><property name="forgeqa.history.comparableRuns" value="${history.comparableRuns}"/><property name="forgeqa.history.N" value="${history.metrics.N}"/><property name="forgeqa.history.F" value="${history.metrics.F}"/><property name="forgeqa.history.I" value="${history.metrics.I}"/><property name="forgeqa.history.P" value="${history.metrics.P}"/><property name="forgeqa.history.retryObservedFlakeRate" value="${xml(numberValue(history.metrics.retryObservedFlakeRate))}"/><property name="forgeqa.history.persistentFailureRate" value="${xml(numberValue(history.metrics.persistentFailureRate))}"/><property name="forgeqa.history.windowStart" value="${xml(history.observationWindow.start)}"/><property name="forgeqa.history.windowEnd" value="${xml(history.observationWindow.end)}"/>`
    : '<property name="forgeqa.history.status" value="NO_BASELINE"/>';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Deadpan" tests="${all.length}" failures="${all.filter((value) => value.blocked).length}" skipped="${all.filter((value) => !value.blocked && ['skipped', 'expected-failure'].includes(value.outcome)).length}"><properties><property name="forgeqa.gate" value="${xml(run.gate?.outcome ?? 'not-evaluated')}"/><property name="forgeqa.completion" value="${run.completion}"/><property name="forgeqa.nativeEvidence" value="${xml(evidence)}"/>${historyProperties}</properties>${cases}<system-err>${xml(violations)}</system-err></testsuite>\n`;
}

export function toMarkdownSummary(run: MergedRunResult, history?: HistoryReportView): string {
  const all = executions(run);
  const evidence = run.evidence
    ? `Native evidence: **${run.evidence.reconciliation.status}** · Blobs: ${run.evidence.nativeBlobCount} · Captured artifacts: ${run.evidence.capturedArtifacts}`
    : 'Native evidence: **not available**';
  const lines = [
    '# Deadpan quality summary',
    '',
    `Run: ${md(run.runId)}`,
    `Completion: **${run.completion}** · Gate: **${run.gate?.outcome ?? 'not evaluated'}**`,
    evidence,
    `Tests: ${all.length} · Attempts: ${run.attempts.length} · Missing: ${run.missingExecutions.length}`,
    '',
    '## Historical reliability',
    ''
  ];
  if (history) {
    lines.push(
      `Status: **${history.status}** · Comparable prior runs: ${history.comparableRuns}`,
      `Window: ${md(history.observationWindow.start)} → ${md(history.observationWindow.end)}`,
      `N/F/I/P: ${history.metrics.N}/${history.metrics.F}/${history.metrics.I}/${history.metrics.P}`,
      `Retry-observed flake rate: **${percent(history.metrics.retryObservedFlakeRate)}** · Persistent-failure rate: **${percent(history.metrics.persistentFailureRate)}**`,
      `Rejected or unavailable observations: ${md(rejectedHistory(history))}`,
      '',
      '| Test | N | F | P | Retry-observed | Persistent | Owner | Last observed |',
      '|---|---:|---:|---:|---:|---:|---|---|',
      ...Object.values(history.tests)
        .sort(
          (a, b) =>
            (b.persistentFailureRate ?? -1) - (a.persistentFailureRate ?? -1) ||
            (b.retryObservedFlakeRate ?? -1) - (a.retryObservedFlakeRate ?? -1) ||
            a.logicalTestId.localeCompare(b.logicalTestId)
        )
        .slice(0, 20)
        .map(
          (value) =>
            `| ${md(value.logicalTestId)} | ${value.N} | ${value.F} | ${value.P} | ${percent(value.retryObservedFlakeRate)} | ${percent(value.persistentFailureRate)} | ${md(value.owner ?? 'unowned')} | ${md(value.lastObservedAt ?? 'none')} |`
        )
    );
  } else {
    lines.push(
      'Status: **NO_BASELINE**. No compatible history analysis was supplied; Deadpan does not invent zero flake rates.'
    );
  }
  lines.push(
    '',
    '## Current executions',
    '',
    '| Test | Project | First attempt | Final outcome | Attempts | Historical N | Historical flake |',
    '|---|---|---|---|---:|---:|---:|',
    ...all.map((execution) => {
      const historical = historyFor(history, execution.final.logicalTestId);
      return `| ${md(execution.final.title ?? execution.final.logicalTestId)} | ${md(execution.final.project ?? 'unknown')} | ${execution.attempts[0]!.outcome} | ${execution.outcome} | ${execution.attempts.length} | ${historical?.N ?? 0} | ${historical ? percent(historical.retryObservedFlakeRate) : 'no baseline'} |`;
    }),
    '',
    '## Gate violations',
    ...(run.gate?.violations.length
      ? run.gate.violations.map((violation) => `- ${md(violation.id)}: ${md(violation.message)}`)
      : ['None recorded.']),
    ''
  );
  return lines.join('\n');
}

/** Report links are local evidence, never active URLs supplied by test content. */
function localEvidencePath(path: string): boolean {
  return (
    /^[\w.-]+(?:\/[\w.-]+)*$/.test(path) && !path.split('/').some((part) => part === '.' || part === '..')
  );
}
function evidenceLink(path: string, label: string): string {
  return localEvidencePath(path)
    ? `<a href="${xml(path)}">${xml(label)}</a>`
    : `<span>${xml(label)} · unsafe path omitted</span>`;
}
function outcomeTone(outcome: string): string {
  return outcome === 'passed'
    ? 'pass'
    : ['failed', 'timed-out', 'unexpected-pass', 'cancelled'].includes(outcome)
      ? 'fail'
      : outcome === 'flaky'
        ? 'warn'
        : 'neutral';
}
function badge(label: string, tone: string): string {
  return `<span class="badge tone-${tone}">${xml(label)}</span>`;
}
function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function toHtmlReport(run: MergedRunResult, history?: HistoryReportView): string {
  const all = executions(run);
  const recovered = all.filter((execution) => execution.outcome === 'flaky').length;
  const incomplete =
    run.completion !== 'complete' ||
    run.missingExecutions.length > 0 ||
    run.unexpectedExecutions.length > 0 ||
    run.duplicateExecutions.length > 0 ||
    Boolean(run.infrastructureErrors?.length);
  const tone =
    incomplete || all.length === 0
      ? 'warn'
      : run.gate?.outcome === 'pass'
        ? 'pass'
        : run.gate?.outcome === 'fail'
          ? 'fail'
          : 'neutral';
  const title = incomplete
    ? 'The evidence is incomplete.'
    : all.length === 0
      ? 'No executions were recorded.'
      : run.gate?.outcome === 'fail'
        ? 'This run needs attention.'
        : run.gate?.outcome === 'pass'
          ? 'The evidence checks out.'
          : 'The gate is not evaluated.';
  const explanation = incomplete
    ? 'An incomplete run cannot establish a clean result. Inspect inventory gaps and infrastructure evidence before drawing conclusions.'
    : all.length === 0
      ? 'No attempt records were attached. An empty report is not evidence of a passing suite, even if an external gate decision is present.'
      : run.gate?.outcome === 'fail'
        ? 'A passing retry does not erase a failure. Start with the policy violations, then follow each execution back to its original evidence.'
        : run.gate?.outcome === 'pass'
          ? 'This run meets its configured quality policy. Every attempt stays visible, including retries, skips and expected failures.'
          : 'Execution evidence is available, but no policy decision was attached. Passing attempts alone are not a quality-gate decision.';
  const counts = Object.fromEntries(
    [
      'passed',
      'failed',
      'flaky',
      'timed-out',
      'expected-failure',
      'unexpected-pass',
      'skipped',
      'cancelled'
    ].map((value) => [value, all.filter((execution) => execution.outcome === value).length])
  );
  const rows = all
    .map((execution, index) => {
      const final = execution.final;
      const historical = historyFor(history, final.logicalTestId);
      const totalDuration = execution.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0);
      const search = [
        final.title ?? final.logicalTestId,
        final.logicalTestId,
        final.project,
        final.environment,
        historical?.owner ?? final.owner
      ]
        .filter(Boolean)
        .join(' ');
      const attempts = execution.attempts
        .map(
          (attempt) =>
            `<section class="attempt" aria-label="Attempt ${attempt.retry + 1}"><h4>Attempt ${attempt.retry + 1} · ${xml(attempt.outcome)} · ${duration(attempt.durationMs)}</h4><pre>${xml(attempt.error?.message ?? 'No assertion error recorded.')}</pre>${
              attempt.artifacts?.length
                ? `<ul class="artifacts">${attempt.artifacts.map((file) => `<li><span class="artifact-state">${xml(file.state)}</span>${xml(file.type)}${file.state === 'captured' && /^(attachments|artifacts)\//.test(file.path) && localEvidencePath(file.path) ? ` · ${evidenceLink(file.path, file.path)}` : ''}${file.size === undefined ? '' : ` · ${file.size} bytes`}${file.sha256 ? `<br><small class="muted">SHA-256 <code>${xml(file.sha256)}</code></small>` : ''}</li>`).join('')}</ul>`
                : '<p class="muted" style="font-size:12px;margin-top:12px">No artifacts declared for this attempt.</p>'
            }</section>`
        )
        .join('');
      return `<article class="execution" data-outcome="${xml(execution.outcome)}" data-attention="${execution.blocked ? 1 : 0}" data-duration="${totalDuration}" data-index="${index}" data-search="${xml(search)}" aria-labelledby="test-${index}"><div class="execution-top"><span class="row-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><div class="execution-title"><h3 id="test-${index}">${xml(final.title ?? final.logicalTestId)}</h3><div class="execution-tags"><span>${xml(final.project ?? 'unknown project')}</span><span>${xml(final.environment ?? 'unknown environment')}</span><code>${xml(final.logicalTestId)}</code></div></div><div class="execution-state">${badge(execution.outcome, outcomeTone(execution.outcome))}<small>${duration(totalDuration)} · ${execution.attempts.length} ${execution.attempts.length === 1 ? 'attempt' : 'attempts'}</small></div></div><details><summary>Attempts & evidence<span class="muted"> · ${execution.blocked ? 'policy blocked' : 'inspect execution'}</span></summary><div class="evidence-detail"><dl class="execution-meta"><div><dt>First attempt → final</dt><dd>${xml(execution.attempts[0]!.outcome)} → ${xml(execution.outcome)}</dd></div><div><dt>Owner</dt><dd>${xml(historical?.owner ?? final.owner ?? 'unowned')}</dd></div><div><dt>Execution ID</dt><dd><code>${xml(final.executionId)}</code></dd></div><div><dt>Historical N / retry-observed / persistent</dt><dd>${historical ? `${historical.N} / ${percent(historical.retryObservedFlakeRate)} / ${percent(historical.persistentFailureRate)}` : 'No comparable observations'}</dd></div></dl><p class="history-note">${xml(historyLine(historical))}</p>${attempts}</div></details></article>`;
    })
    .join('');
  const violations = run.gate?.violations ?? [];
  const gate = `<section aria-labelledby="gate-heading"><span class="eyebrow">01 / Decision</span><h2 id="gate-heading">Quality gate</h2><div class="gate-status">${badge(run.gate?.outcome === 'pass' ? 'Gate passed' : run.gate?.outcome === 'fail' ? 'Gate failed' : 'Not evaluated', tone)}<code>${xml(run.completion)}</code></div>${
    violations.length
      ? `<ul>${violations.map((violation) => `<li><strong>${xml(violation.id)}</strong> · ${xml(violation.severity)}<br>${xml(violation.message)}${violation.remediation ? `<br><span class="muted">${xml(violation.remediation)}</span>` : ''}</li>`).join('')}</ul>`
      : `<p class="muted">${run.gate ? 'No policy violations recorded.' : 'No gate decision was attached to this report.'}</p>`
  }${
    incomplete
      ? `<p><strong>Inventory requires attention.</strong></p><ul>${[
          ['Missing', run.missingExecutions],
          ['Unexpected', run.unexpectedExecutions],
          ['Duplicate', run.duplicateExecutions]
        ]
          .filter(([, ids]) => (ids as string[]).length)
          .map(
            ([label, ids]) =>
              `<li>${label}: ${(ids as string[]).map((id) => `<code>${xml(id)}</code>`).join(', ')}</li>`
          )
          .join(
            ''
          )}${(run.infrastructureErrors ?? []).map((error) => `<li>${xml(error)}</li>`).join('')}</ul>`
      : ''
  }</section>`;
  const native = `<section aria-labelledby="native-heading"><span class="eyebrow">02 / Provenance</span><h2 id="native-heading">Native evidence</h2>${
    run.evidence
      ? `<p><strong>${xml(run.evidence.reconciliation.status)}</strong> with Playwright's native report.</p><dl class="mini-stats"><div><dt>Blob reports</dt><dd>${run.evidence.nativeBlobCount}</dd></div><div><dt>Captured artifacts</dt><dd>${run.evidence.capturedArtifacts}</dd></div><div><dt>Missing declarations</dt><dd>${run.evidence.missingArtifacts}</dd></div><div><dt>Unavailable declarations</dt><dd>${run.evidence.unavailableArtifacts}</dd></div></dl><div class="rail-links">${evidenceLink(run.evidence.nativeReport, 'Open merged Playwright report')}${evidenceLink(run.evidence.artifactManifest, 'Artifact manifest')}${evidenceLink(run.evidence.nativeJson, 'Native JSON evidence')}</div>`
      : '<p class="muted">Native distributed evidence was not attached to this report. No reconciliation claim is made.</p>'
  }</section>`;
  const historySection = `<section class="history" aria-labelledby="history-heading"><header><h2 id="history-heading">Historical reliability</h2><span class="eyebrow">Status: ${xml(history?.status ?? 'NO_BASELINE')}</span></header>${
    history
      ? `<p>${history.comparableRuns} comparable prior runs · window ${xml(history.observationWindow.start)} to ${xml(history.observationWindow.end)}</p><dl class="history-grid">${[
          ['Eligible executions (N)', history.metrics.N],
          ['Retry-recovered (F)', history.metrics.F],
          ['Initial failures (I)', history.metrics.I],
          ['Persistent failures (P)', history.metrics.P],
          ['Retry-observed flake rate', percent(history.metrics.retryObservedFlakeRate)],
          ['Persistent-failure rate', percent(history.metrics.persistentFailureRate)]
        ]
          .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
          .join(
            ''
          )}</dl><p>Rejected or unavailable observations: ${xml(rejectedHistory(history))}</p><p>Added tests: ${history.comparison.added.length} · Removed tests: ${history.comparison.removed.length} · Shared tests: ${history.comparison.shared.length}</p>`
      : '<p>No compatible history analysis was supplied; Deadpan does not invent zero flake rates. Compare compatible runs before interpreting reliability over time.</p>'
  }</section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Deadpan · Test evidence</title><style>${reportStyles}</style></head><body><a class="skip" href="#test-heading">Skip to executions</a><div class="shell"><header class="masthead"><a class="wordmark" href="#top" aria-label="Deadpan report"><span class="brand-mark" aria-hidden="true"></span>deadpan</a><nav aria-label="Report sections"><a href="#test-heading">Executions</a><a href="#history-heading">History</a><a href="#gate-heading">Gate decision</a></nav></header><main id="top"><section class="hero" aria-labelledby="report-title"><div><div class="eyebrow">Test evidence / ${xml(run.revision.repository)}</div><h1 id="report-title">${title}</h1><p>${explanation}</p></div><dl class="run-reference"><div><dt>Run ID</dt><dd><code>${xml(run.runId)}</code></dd></div><div><dt>Tested commit</dt><dd><code title="${xml(run.revision.testedCommit)}">${xml(run.revision.testedCommit.slice(0, 12))}</code></dd></div><div><dt>Branch</dt><dd>${xml(run.revision.branch ?? 'not recorded')}</dd></div><div><dt>Shards received</dt><dd>${run.shardIds.length}</dd></div></dl></section><dl class="summary-strip"><div class="stat"><dt>Executions observed</dt><dd>${all.length}</dd><small>distinct test executions</small></div><div class="stat"><dt>Attempts retained</dt><dd>${run.attempts.length}</dd><small>originals and retries</small></div><div class="stat"><dt>Retry-recovered</dt><dd>${recovered}</dd><small>still reported as flaky</small></div><div class="stat"><dt>Missing executions</dt><dd>${run.missingExecutions.length}</dd><small>expected but not observed</small></div></dl><div class="workbench"><section class="test-area" aria-labelledby="test-heading"><div class="section-heading"><h2 id="test-heading" tabindex="-1">Current executions</h2><span class="eyebrow">Every attempt counts</span></div><noscript><p class="noscript">All executions are shown. Enable JavaScript to search, filter and sort; evidence remains readable without it.</p></noscript><div class="filters" role="search" aria-label="Filter executions" hidden><label for="search">Search tests<input id="search" type="search" placeholder="Title, ID, project or owner" autocomplete="off"></label><label for="outcome">Outcome<select id="outcome"><option value="all">All outcomes (${all.length})</option>${Object.entries(
    counts
  )
    .map(([value, count]) => `<option value="${value}">${value} (${count})</option>`)
    .join(
      ''
    )}</select></label><label for="sort">Sort by<select id="sort"><option value="attention">Needs attention</option><option value="duration">Slowest first</option><option value="name">Test name</option></select></label></div><div class="filter-meta" hidden><p id="result-count" role="status" aria-live="polite" aria-atomic="true">${all.length} of ${all.length} executions</p><button id="clear-filters" type="button" disabled>Clear filters</button></div><div id="executions" class="execution-list">${rows}</div><div class="empty" id="empty-filter" hidden><h3>No matching executions</h3><p>Try a different title, ID, project or owner, or clear your filters to see the full run.</p><button id="reset-filters" type="button">Reset filters</button></div>${all.length ? '' : '<div class="empty"><h3>No executions recorded</h3><p>This report contains no attempt records. Check the gate decision and expected inventory; an empty report is not evidence of a passing suite.</p></div>'}${historySection}</section><aside class="rail" aria-label="Run context">${gate}${native}<section aria-labelledby="reading-heading"><span class="eyebrow">03 / Reading the run</span><h2 id="reading-heading">Keep the first failure.</h2><p class="muted">Expand any execution for its complete attempt sequence, original diagnostic, artifact state and historical context.</p><p class="muted">Durations sum recorded attempts. They are not parallel wall-clock time.</p></section></aside></div></main><footer class="footer"><p>Traces, videos and screenshots can contain sensitive data. Only synthetic captures belong in public demonstrations.</p><span class="mono">Deadpan / evidence, without the spin.</span></footer></div><script>${reportScript}</script></body></html>`;
}

export function reportChecksums(outputs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(outputs).map(([name, value]) => [name, sha256(value)]));
}
