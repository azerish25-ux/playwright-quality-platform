import { digestValue } from './inventory.mjs';

/** Compare actual native test identities, not counts or reporter-specific run IDs. */
export function nativeInventory(report) {
  if (!report || !Array.isArray(report.suites) || !Array.isArray(report.errors) || report.errors.length) throw new Error('Native report is missing or contains global errors.');
  const entries = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const id = test.annotations?.find(value => value.type === 'forgeqa-id')?.description;
        if (!id || !test.projectName || test.status !== 'expected' || test.results?.length !== 1 || test.results[0].status !== 'passed' || test.results[0].retry !== 0) throw new Error('Native inventory contains an unidentified, skipped, retried or failed test.');
        entries.push({ id, project: test.projectName, file: spec.file.replaceAll('\\', '/'), line: spec.line, column: spec.column, title: spec.title });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  if (!entries.length) throw new Error('Native inventory is empty.');
  entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const keys = entries.map(value => `${value.project}:${value.id}`);
  if (new Set(keys).size !== keys.length) throw new Error('Native inventory contains duplicate identities.');
  return { count: entries.length, digest: digestValue(entries), entries };
}
