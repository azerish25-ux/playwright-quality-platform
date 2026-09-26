import { mkdir, rm, symlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scope = resolve(root, 'node_modules', '@azerish25-ux');
await mkdir(scope, { recursive: true });
const links = {
  'forgeqa-core': 'packages/core',
  'forgeqa-api': 'packages/api',
  'forgeqa-test-data': 'packages/test-data',
  'forgeqa-reporter': 'packages/reporter',
  'forgeqa-flake-analysis': 'packages/flake-analysis',
  'forgeqa-playwright': 'packages/playwright',
  'forgeqa-github': 'packages/github-action',
  'forgeqa-cli': 'packages/cli'
};
for (const [name, target] of Object.entries(links)) {
  const destination = resolve(scope, name);
  await rm(destination, { recursive: true, force: true });
  await symlink(resolve(root, target), destination, 'dir');
}
