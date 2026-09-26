import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const roots = ['packages', 'examples', 'tests'];
const violations = [];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory() && !['node_modules','dist','.git','.tmp','forgeqa-results','test-results'].includes(entry.name)) await walk(full);
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      const text = await readFile(full, 'utf8');
      if (/\.waitForTimeout\s*\(/.test(text)) violations.push(`${full}: fixed browser sleep`);
      if (/continue-on-error\s*:\s*true/.test(text)) violations.push(`${full}: broad continue-on-error`);
      if (/\|\|\s*true/.test(text)) violations.push(`${full}: swallowed command failure`);
    }
  }
}
for (const root of roots) await walk(root);
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Static policy checks passed.');
}
