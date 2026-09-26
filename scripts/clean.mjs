import { rm } from 'node:fs/promises';
const paths = [
  'node_modules', '.tmp', 'forgeqa-results',
  ...['core','api','test-data','reporter','flake-analysis','playwright','github-action','cli'].flatMap((name) => [
    `packages/${name}/dist`, `packages/${name}/tsconfig.tsbuildinfo`
  ])
];
for (const path of paths) await rm(path, { recursive: true, force: true });
