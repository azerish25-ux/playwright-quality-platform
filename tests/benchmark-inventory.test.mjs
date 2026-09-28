import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertEquivalentExecutionInventory,
  canonicalExpectedInventory,
  expectedInventoryDigest,
  observedInventoryDigest,
  projectInventory
} from '../benchmarks/lib/inventory.mjs';

const expected = [
  { executionId: 'execution-b', logicalTestId: 'test-b', project: 'chromium', environment: 'ci', shardIndex: 2, shardTotal: 2 },
  { executionId: 'execution-a', logicalTestId: 'test-a', project: 'api', environment: 'ci', shardIndex: 1, shardTotal: 2 }
];

test('benchmark inventory digests are order independent and execution exact', () => {
  assert.deepEqual(canonicalExpectedInventory(expected).map(entry => entry.executionId), ['execution-a', 'execution-b']);
  assert.equal(expectedInventoryDigest(expected), expectedInventoryDigest([...expected].reverse()));
  assert.equal(observedInventoryDigest([{ executionId: 'execution-b' }, { executionId: 'execution-a' }]), expectedInventoryDigest(expected));
  assert.deepEqual(projectInventory(expected), { api: 1, chromium: 1 });
  assert.deepEqual(assertEquivalentExecutionInventory(expected, [{ executionId: 'execution-b' }, { executionId: 'execution-a' }]).identities, ['execution-a', 'execution-b']);
});

test('benchmark inventory rejects missing, unexpected, and duplicate expected identities', () => {
  assert.throws(() => assertEquivalentExecutionInventory(expected, [{ executionId: 'execution-a' }]), /1 missing/);
  assert.throws(() => assertEquivalentExecutionInventory(expected, [{ executionId: 'execution-a' }, { executionId: 'execution-b' }, { executionId: 'execution-c' }]), /1 unexpected/);
  assert.throws(() => canonicalExpectedInventory([expected[0], expected[0]]), /duplicate execution identities/);
});
