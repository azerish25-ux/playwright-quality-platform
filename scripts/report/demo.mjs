import { mkdir, writeFile } from 'node:fs/promises';
import { toHtmlReport, toJsonReport } from '@azerish25-ux/forgeqa-reporter';
import { reportFixture } from './fixture.mjs';
const root = 'evidence/report-demo';
await mkdir(`${root}/artifacts`, { recursive: true });
const run = reportFixture();
await writeFile(`${root}/index.html`, toHtmlReport(run));
await writeFile(`${root}/report.json`, toJsonReport(run));
await writeFile(
  `${root}/artifacts/diagnostic.txt`,
  'Synthetic diagnostic fixture. No user data or production execution evidence.\n'
);
console.log(`Synthetic report generated in ${root}. Preview with: npm run forgeqa -- report serve ${root}`);
