import { readFile, readdir, stat } from 'node:fs/promises';
const packageNames = ['core','api','test-data','reporter','flake-analysis','playwright','github-action','cli'];
const errors = [];
for (const name of packageNames) {
  const pkg = JSON.parse(await readFile(`packages/${name}/package.json`, 'utf8'));
  if (!pkg.name?.startsWith('@azerish25-ux/forgeqa-')) errors.push(`${name}: invalid name`);
  if (!pkg.exports) errors.push(`${name}: missing exports`);
  if (!pkg.types) errors.push(`${name}: missing types`);
  try { await stat(`packages/${name}/dist/index.js`); } catch { errors.push(`${name}: missing dist/index.js`); }
  const files = await readdir(`packages/${name}/dist`);
  if (!files.some((file) => file.endsWith('.d.ts'))) errors.push(`${name}: missing declarations`);
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Package audit passed.');
