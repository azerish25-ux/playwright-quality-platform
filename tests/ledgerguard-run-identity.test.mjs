import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('LedgerGuard durable command keys include Deadpan run identity', async () => {
  const source = await readFile('consumers/ledgerguard/tests/fixtures.ts', 'utf8');
  assert.match(source, /runId:\s*forgeRunId\(testInfo\)/);
  assert.match(source, /testInfo\.config\.metadata\['forgeqa'\]/);
  assert.match(source, /Deadpan run metadata is required for LedgerGuard durable command identity/);
  assert.doesNotMatch(
    source,
    /stableHash\(\{\s*testId:\s*testInfo\.testId,\s*retry:/,
    'Durable idempotency keys must not be shared by separate Deadpan runs.'
  );
});
