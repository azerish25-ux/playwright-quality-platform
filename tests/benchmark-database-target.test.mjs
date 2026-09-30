import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { benchmarkDatabaseTarget } from '../benchmarks/lib/database-target.mjs';
const image = `mcr.microsoft.com/playwright:v1.58.2-noble@sha256:${'a'.repeat(64)}`;
const env = { TEAMBOARD_TEST_MODE: '1', DATABASE_URL: 'postgresql://runtime@127.0.0.1:5432/forgeqa_test' };
test('benchmark database accepts only explicit disposable loopback or its pinned-container service', () => {
  assert.equal(benchmarkDatabaseTarget(env), env.DATABASE_URL);
  const container = { ...env, FORGEQA_BENCHMARK_IMAGE: image, DATABASE_URL: 'postgresql://runtime@postgres:5432/forgeqa_test' };
  assert.equal(benchmarkDatabaseTarget(container), container.DATABASE_URL);
  for (const patch of [{ TEAMBOARD_TEST_MODE: '0' }, { DATABASE_URL: '' }, { DATABASE_URL: 'postgresql://runtime@postgres:5432/forgeqa_test' },
    { DATABASE_URL: 'postgresql://runtime@public.example/forgeqa_test', FORGEQA_BENCHMARK_IMAGE: image },
    { DATABASE_URL: 'postgresql://runtime@postgres/production', FORGEQA_BENCHMARK_IMAGE: image },
    { DATABASE_URL: 'https://127.0.0.1/forgeqa_test' }, { DATABASE_URL: container.DATABASE_URL, FORGEQA_BENCHMARK_IMAGE: 'playwright:latest' }]) {
    assert.throws(() => benchmarkDatabaseTarget({ ...env, ...patch }));
  }
});
test('container benchmarks use an actually root-owned home without disabling browser security checks', async () => {
  for (const name of ['benchmark.yml', 'benchmark-controlled.yml', 'benchmark-secondary.yml']) {
    const source = await readFile(`.github/workflows/${name}`, 'utf8');
    assert.match(source, /HOME: \/root/);
    assert.doesNotMatch(source, /MOZ_DISABLE_CONTENT_SANDBOX|--privileged|safe\.directory=\*/);
  }
  const controlled = await readFile('.github/workflows/benchmark-controlled.yml', 'utf8');
  assert.match(controlled, /git -c safe\.directory="\$GITHUB_WORKSPACE" archive/);
});
