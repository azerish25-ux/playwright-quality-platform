import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('integration files serialize access to generated workspace distributions', () => {
  const command = packageJson.scripts?.['test:integration'];
  assert.equal(typeof command, 'string');
  assert.match(command, /(?:^|\s)--test-concurrency(?:=|\s+)1(?:\s|$)/);
  assert.match(command, /tests\/integration\/\*\.test\.mjs/);
});
