import { sha256, type AttemptRecord, type MergedRunResult } from '@azerish25-ux/forgeqa-core';

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
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '�').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}
function md(value: string): string {
  return xml(value).replace(/[`|\r\n]/g, ' ').replace(/@/g, '＠');
}
function percent(value: number | null): string {
  return value === null ? 'insufficient' : `${(value * 100).toFixed(2)}%`;
}
function numberValue(value: number | null): string {
  return value === null ? 'insufficient' : String(value);
}
function historyFor(history: HistoryReportView | undefined, logicalTestId: string): HistoryReportTest | undefined {
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

export function executions(run: MergedRunResult): Array<{ final: AttemptRecord; attempts: AttemptRecord[]; outcome: string; blocked: boolean }> {
  const map = new Map<string, AttemptRecord[]>();
  for (const attempt of run.attempts) map.set(attempt.executionId, [...(map.get(attempt.executionId) ?? []), attempt]);
  return [...map.values()].map(attempts => {
    attempts.sort((a, b) => a.retry - b.retry);
    const final = attempts[attempts.length - 1]!;
    const flaky = final.outcome === 'passed' && attempts.some(attempt => ['failed', 'timed-out'].includes(attempt.outcome));
    const outcome = flaky ? 'flaky' : final.outcome;
    const blocked = ['failed', 'timed-out', 'unexpected-pass', 'cancelled'].includes(outcome)
      || (run.gate?.violations.some(violation => violation.affected?.includes(final.executionId) && violation.severity === 'error') ?? false)
      || (flaky && run.gate?.outcome === 'fail');
    return { final, attempts, outcome, blocked };
  });
}

export function toJsonReport(run: MergedRunResult): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}

export function toJUnit(run: MergedRunResult, history?: HistoryReportView): string {
  const all = executions(run);
  const cases = all.map(execution => {
    const attempt = execution.final;
    const historical = historyFor(history, attempt.logicalTestId);
    const attrs = `name="${xml(attempt.title ?? attempt.logicalTestId)}" classname="${xml(attempt.project ?? attempt.executionId)}" time="${(execution.attempts.reduce((sum, value) => sum + value.durationMs, 0) / 1000).toFixed(3)}"`;
    const original = execution.attempts.find(value => value.error)?.error;
    const diagnostic = [
      ...execution.attempts.map(value => `attempt ${value.retry}: ${value.outcome}\n${value.error?.message ?? ''}`),
      historyLine(historical)
    ].join('\n');
    const failure = execution.blocked ? `<failure message="${xml(original?.message ?? execution.outcome)}" type="${xml(execution.outcome)}">${xml(diagnostic)}</failure>` : '';
    const skipped = !execution.blocked && ['skipped', 'expected-failure'].includes(execution.outcome) ? `<skipped message="${xml(execution.outcome)}"/>` : '';
    const properties = historical
      ? `<properties><property name="forgeqa.history.N" value="${historical.N}"/><property name="forgeqa.history.F" value="${historical.F}"/><property name="forgeqa.history.I" value="${historical.I}"/><property name="forgeqa.history.P" value="${historical.P}"/><property name="forgeqa.history.retryObservedFlakeRate" value="${xml(numberValue(historical.retryObservedFlakeRate))}"/><property name="forgeqa.history.persistentFailureRate" value="${xml(numberValue(historical.persistentFailureRate))}"/><property name="forgeqa.history.owner" value="${xml(historical.owner ?? 'unowned')}"/></properties>`
      : '';
    return `<testcase ${attrs}>${properties}${failure}${skipped}<system-out>${xml(diagnostic)}</system-out></testcase>`;
  }).join('');
  const violations = run.gate?.violations.map(violation => `${violation.id}: ${violation.message}`).join('\n') ?? '';
  const evidence = run.evidence?.reconciliation.status ?? 'not-available';
  const historyProperties = history
    ? `<property name="forgeqa.history.status" value="${xml(history.status)}"/><property name="forgeqa.history.comparableRuns" value="${history.comparableRuns}"/><property name="forgeqa.history.N" value="${history.metrics.N}"/><property name="forgeqa.history.F" value="${history.metrics.F}"/><property name="forgeqa.history.I" value="${history.metrics.I}"/><property name="forgeqa.history.P" value="${history.metrics.P}"/><property name="forgeqa.history.retryObservedFlakeRate" value="${xml(numberValue(history.metrics.retryObservedFlakeRate))}"/><property name="forgeqa.history.persistentFailureRate" value="${xml(numberValue(history.metrics.persistentFailureRate))}"/><property name="forgeqa.history.windowStart" value="${xml(history.observationWindow.start)}"/><property name="forgeqa.history.windowEnd" value="${xml(history.observationWindow.end)}"/>`
    : '<property name="forgeqa.history.status" value="NO_BASELINE"/>';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="ForgeQA" tests="${all.length}" failures="${all.filter(value => value.blocked).length}" skipped="${all.filter(value => !value.blocked && ['skipped', 'expected-failure'].includes(value.outcome)).length}"><properties><property name="forgeqa.gate" value="${xml(run.gate?.outcome ?? 'not-evaluated')}"/><property name="forgeqa.completion" value="${run.completion}"/><property name="forgeqa.nativeEvidence" value="${xml(evidence)}"/>${historyProperties}</properties>${cases}<system-err>${xml(violations)}</system-err></testsuite>\n`;
}

export function toMarkdownSummary(run: MergedRunResult, history?: HistoryReportView): string {
  const all = executions(run);
  const evidence = run.evidence
    ? `Native evidence: **${run.evidence.reconciliation.status}** · Blobs: ${run.evidence.nativeBlobCount} · Captured artifacts: ${run.evidence.capturedArtifacts}`
    : 'Native evidence: **not available**';
  const lines = [
    '# ForgeQA quality summary',
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
        .sort((a, b) => (b.persistentFailureRate ?? -1) - (a.persistentFailureRate ?? -1) || (b.retryObservedFlakeRate ?? -1) - (a.retryObservedFlakeRate ?? -1) || a.logicalTestId.localeCompare(b.logicalTestId))
        .slice(0, 20)
        .map(value => `| ${md(value.logicalTestId)} | ${value.N} | ${value.F} | ${value.P} | ${percent(value.retryObservedFlakeRate)} | ${percent(value.persistentFailureRate)} | ${md(value.owner ?? 'unowned')} | ${md(value.lastObservedAt ?? 'none')} |`)
    );
  } else {
    lines.push('Status: **NO_BASELINE**. No compatible history analysis was supplied; ForgeQA does not invent zero flake rates.');
  }
  lines.push(
    '',
    '## Current executions',
    '',
    '| Test | Project | First attempt | Final outcome | Attempts | Historical N | Historical flake |',
    '|---|---|---|---|---:|---:|---:|',
    ...all.map(execution => {
      const historical = historyFor(history, execution.final.logicalTestId);
      return `| ${md(execution.final.title ?? execution.final.logicalTestId)} | ${md(execution.final.project ?? 'unknown')} | ${execution.attempts[0]!.outcome} | ${execution.outcome} | ${execution.attempts.length} | ${historical?.N ?? 0} | ${historical ? percent(historical.retryObservedFlakeRate) : 'no baseline'} |`;
    }),
    '',
    '## Gate violations',
    ...(run.gate?.violations.length ? run.gate.violations.map(violation => `- ${md(violation.id)}: ${md(violation.message)}`) : ['None recorded.']),
    ''
  );
  return lines.join('\n');
}

export function toHtmlReport(run: MergedRunResult, history?: HistoryReportView): string {
  const all = executions(run);
  const rows = all.map(execution => {
    const historical = historyFor(history, execution.final.logicalTestId);
    return `<tr data-outcome="${xml(execution.outcome)}"><td><strong>${xml(execution.final.title ?? execution.final.logicalTestId)}</strong><br/><small>${xml(execution.final.logicalTestId)} · ${xml(execution.final.project ?? 'unknown')} · ${xml(execution.final.environment ?? 'unknown')}</small></td><td>${execution.attempts[0]!.outcome}</td><td>${execution.outcome}</td><td>${execution.attempts.length}</td><td>${historical?.N ?? '—'}</td><td>${historical ? percent(historical.retryObservedFlakeRate) : 'no baseline'}</td><td>${historical ? percent(historical.persistentFailureRate) : 'no baseline'}</td><td>${xml(historical?.owner ?? execution.final.owner ?? 'unowned')}</td><td><details><summary>Attempts & evidence</summary><p>${xml(historyLine(historical))}</p>${execution.attempts.map(attempt => `<h3>Attempt ${attempt.retry + 1}: ${attempt.outcome} (${attempt.durationMs} ms)</h3><pre>${xml(attempt.error?.message ?? 'No assertion error recorded.')}</pre><ul>${(attempt.artifacts ?? []).map(file => `<li>${xml(file.type)}: ${file.state}${file.state === 'captured' && /^(attachments|artifacts)\/[\w./-]+$/.test(file.path) && !file.path.split('/').includes('..') ? ` — <a href="${xml(file.path)}">${xml(file.path)}</a>` : ''}${file.size === undefined ? '' : ` (${file.size} bytes)`}</li>`).join('')}</ul>`).join('')}</details></td></tr>`;
  }).join('');
  const evidence = run.evidence
    ? `<p><strong>Native evidence: ${xml(run.evidence.reconciliation.status)}</strong> · ${run.evidence.nativeBlobCount} blob reports · ${run.evidence.capturedArtifacts} captured artifacts · ${run.evidence.missingArtifacts} missing declarations · ${run.evidence.unavailableArtifacts} unavailable declarations</p><p><a href="${xml(run.evidence.nativeReport)}">Open merged Playwright report</a> · <a href="${xml(run.evidence.artifactManifest)}">Artifact manifest</a> · <a href="${xml(run.evidence.nativeJson)}">Native JSON evidence</a></p>`
    : '<p>Native distributed evidence was not attached to this report.</p>';
  const historySection = history
    ? `<section aria-labelledby="history-heading"><h2 id="history-heading">Historical reliability</h2><p><strong>Status: ${xml(history.status)}</strong> · ${history.comparableRuns} comparable prior runs · window ${xml(history.observationWindow.start)} to ${xml(history.observationWindow.end)}</p><dl><div><dt>Eligible executions (N)</dt><dd>${history.metrics.N}</dd></div><div><dt>Retry-recovered (F)</dt><dd>${history.metrics.F}</dd></div><div><dt>Initial failures (I)</dt><dd>${history.metrics.I}</dd></div><div><dt>Persistent failures (P)</dt><dd>${history.metrics.P}</dd></div><div><dt>Retry-observed flake rate</dt><dd>${percent(history.metrics.retryObservedFlakeRate)}</dd></div><div><dt>Persistent-failure rate</dt><dd>${percent(history.metrics.persistentFailureRate)}</dd></div></dl><p>Rejected or unavailable observations: ${xml(rejectedHistory(history))}</p><p>Added tests: ${history.comparison.added.length} · Removed tests: ${history.comparison.removed.length} · Shared tests: ${history.comparison.shared.length}</p></section>`
    : '<section aria-labelledby="history-heading"><h2 id="history-heading">Historical reliability</h2><p><strong>Status: NO_BASELINE.</strong> No compatible history analysis was supplied; ForgeQA does not invent zero flake rates.</p></section>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ForgeQA · Test evidence</title><style>body{font:15px system-ui;background:#f3f5f5;color:#1c3034;margin:auto;max-width:1500px;padding:32px}h1{font-size:34px}table{border-collapse:collapse;width:100%;background:white}th,td{padding:14px;border-bottom:1px solid #d7e0e1;text-align:left;vertical-align:top}th{background:#173b40;color:white}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:620px}small{color:#55686d}input,select{font:inherit;padding:10px;margin:8px;border:1px solid #a8bbc0}section{background:white;padding:18px;margin:20px 0}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}dl div{border:1px solid #d7e0e1;padding:10px}dt{font-weight:700}dd{margin:4px 0 0}a:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #af7222}h3{font-size:14px}.scroll{overflow:auto}</style></head><body><h1>ForgeQA test evidence</h1><p>Run <code>${xml(run.runId)}</code></p><section><strong>Gate: ${run.gate?.outcome ?? 'not evaluated'} · ${run.completion}</strong><p>${all.length} tests · ${run.attempts.length} attempts · ${all.filter(execution => execution.outcome === 'flaky').length} retry-recovered · ${run.missingExecutions.length} missing executions</p>${evidence}<ul>${(run.gate?.violations ?? []).map(violation => `<li>${xml(violation.id)}: ${xml(violation.message)}</li>`).join('')}</ul></section>${historySection}<label>Search tests<input id="search" type="search"></label><label>Outcome<select id="outcome"><option value="all">All</option>${['passed', 'failed', 'flaky', 'timed-out', 'expected-failure', 'unexpected-pass', 'skipped', 'cancelled'].map(value => `<option>${value}</option>`).join('')}</select></label><div class="scroll"><table><thead><tr><th>Test</th><th>First attempt</th><th>Final outcome</th><th>Attempts</th><th>Historical N</th><th>Retry-observed</th><th>Persistent</th><th>Owner</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div><p>Traces, videos and screenshots can contain sensitive data. Only synthetic captures belong in public demonstrations.</p><script>const s=document.getElementById('search'),o=document.getElementById('outcome');function filter(){for(const r of document.querySelectorAll('tbody tr'))r.hidden=!(r.textContent.toLowerCase().includes(s.value.toLowerCase())&&(o.value==='all'||r.dataset.outcome===o.value));}s.addEventListener('input',filter);o.addEventListener('change',filter);</script></body></html>`;
}

export function reportChecksums(outputs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(outputs).map(([name, value]) => [name, sha256(value)]));
}
