import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeInventory } from '../benchmarks/lib/native-inventory.mjs';
function report() { return { errors: [], suites: [{ specs: [{ file: 'tests/a.ts', title: 'Journey', line: 4, column: 1, tests: [{ projectName: 'chromium', annotations: [{ type: 'forgeqa-id', description: 'stable-test' }], status: 'expected', results: [{ status: 'passed', retry: 0 }] }] }] }] }; }
test('native comparison rejects skipped tests, retries, errors and same-count substitution', () => {
  const original = report();
  const inventory = nativeInventory(original);
  assert.equal(inventory.count, 1);
  const substituted = report();
  substituted.suites[0].specs[0].tests[0].annotations[0].description = 'other-test';
  assert.notEqual(nativeInventory(substituted).digest, inventory.digest);
  for (const status of ['skipped', 'failed', 'timedOut']) {
    const changed = report();
    changed.suites[0].specs[0].tests[0].results[0].status = status;
    assert.throws(() => nativeInventory(changed), /skipped, retried or failed/);
  }
  original.suites[0].specs[0].tests[0].results.push({ status: 'passed', retry: 1 });
  assert.throws(() => nativeInventory(original), /retried/);
  assert.throws(() => nativeInventory({ suites: [], errors: [] }), /empty/);
  assert.throws(() => nativeInventory({ ...report(), errors: [{ message: 'crash' }] }), /global errors/);
});
