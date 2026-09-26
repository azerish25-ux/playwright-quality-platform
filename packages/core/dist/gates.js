function byExecution(attempts) {
    const map = new Map();
    for (const attempt of attempts)
        map.set(attempt.executionId, [...(map.get(attempt.executionId) ?? []), attempt]);
    for (const values of map.values())
        values.sort((a, b) => a.retry - b.retry);
    return map;
}
export function evaluateGates(run, quarantines, policy) {
    const violations = [];
    if (run.completion !== 'complete')
        violations.push({ id: 'run.incomplete', severity: 'error', message: `Run completion is ${run.completion}.`, remediation: 'Repair infrastructure and rerun the complete inventory.' });
    if (policy.requireCompleteShards && (run.missingExecutions.length || run.duplicateExecutions.length))
        violations.push({ id: 'inventory.incomplete', severity: 'error', message: 'Expected execution inventory was not reconciled.', affected: [...run.missingExecutions, ...run.duplicateExecutions], remediation: 'Restore missing shards and remove duplicate execution.' });
    let skipped = 0;
    for (const [executionId, attempts] of byExecution(run.attempts)) {
        const first = attempts[0];
        const last = attempts.at(-1);
        if (last.outcome === 'failed' || last.outcome === 'timed-out' || last.outcome === 'unexpected-pass' || last.outcome === 'cancelled')
            violations.push({ id: 'test.unexpected-outcome', severity: 'error', message: `Execution ${executionId} ended as ${last.outcome}.`, affected: [last.logicalTestId], remediation: 'Fix the test or application defect; do not suppress the result.' });
        if (first.outcome === 'failed' && last.outcome === 'passed' && policy.failOnRetryRecovered)
            violations.push({ id: 'test.retry-recovered', severity: 'error', message: `Execution ${executionId} recovered on retry.`, affected: [last.logicalTestId], remediation: 'Investigate nondeterminism; strict policy treats recovery as flakiness.' });
        if (last.outcome === 'skipped')
            skipped += 1;
    }
    if (skipped > policy.unexpectedSkipBudget)
        violations.push({ id: 'test.skip-budget', severity: 'error', message: `Unexpected skips ${skipped} exceed budget.`, observed: skipped, threshold: policy.unexpectedSkipBudget, remediation: 'Restore coverage or document an explicit selection policy.' });
    if (quarantines.length > policy.maxQuarantineEntries)
        violations.push({ id: 'quarantine.limit', severity: 'error', message: 'Quarantine count exceeds policy.', observed: quarantines.length, threshold: policy.maxQuarantineEntries, remediation: 'Resolve or remove accountable quarantine records.' });
    const now = Date.now();
    for (const entry of quarantines)
        if (Date.parse(entry.expiresAt) <= now)
            violations.push({ id: 'quarantine.expired', severity: 'error', message: `Quarantine expired for ${entry.testId}.`, affected: [entry.testId], remediation: 'Fix the defect or explicitly create a new reviewed record.' });
    return { outcome: violations.some((v) => v.severity === 'error') ? 'fail' : 'pass', violations };
}
//# sourceMappingURL=gates.js.map