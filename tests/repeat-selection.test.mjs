import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStableTest } from '../packages/cli/dist/runner.js';

function execution(overrides = {}) {
  return {
    executionId: 'execution-1',
    logicalTestId: 'checkout-payment',
    project: 'chromium',
    browser: 'chromium',
    environment: 'ci',
    shardIndex: 1,
    shardTotal: 1,
    title: 'payment succeeds',
    relativePath: 'tests/checkout.spec.ts',
    line: 42,
    column: 3,
    repetition: 0,
    ...overrides
  };
}

test('stable-test targeting selects the exact declared file and line across projects', () => {
  const target = selectStableTest([
    execution(),
    execution({ executionId: 'execution-2', project: 'firefox', browser: 'firefox' }),
    execution({ executionId: 'other', logicalTestId: 'profile-save', relativePath: 'tests/profile.spec.ts', line: 8 })
  ], 'checkout-payment');
  assert.equal(target.expected.length, 2);
  assert.deepEqual(target.selectors, ['tests/checkout.spec.ts:42']);
});

test('stable-test targeting rejects unknown IDs and contradictory declaration locations', () => {
  assert.throws(() => selectStableTest([execution()], 'missing'), error => error?.code === 'FORGEQA_CONFIG' && /Unknown stable test ID/.test(error.message));
  assert.throws(
    () => selectStableTest([execution(), execution({ executionId: 'execution-2', relativePath: 'tests/other.spec.ts', line: 9 })], 'checkout-payment'),
    error => error?.code === 'FORGEQA_INTEGRITY' && /multiple declarations/.test(error.message)
  );
});

test('stable-test targeting fails closed when source location evidence is absent', () => {
  assert.throws(
    () => selectStableTest([execution({ line: undefined })], 'checkout-payment'),
    error => error?.code === 'FORGEQA_INTEGRITY' && /source location/.test(error.message)
  );
});
