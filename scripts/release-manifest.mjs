import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const packages=['core','api','test-data','reporter','flake-analysis','playwright','github-action','cli'];
const entries=[];for(const name of packages){const pkg=JSON.parse(await readFile(`packages/${name}/package.json`,'utf8'));const bytes=await readFile(`packages/${name}/dist/index.js`);entries.push({name:pkg.name,version:pkg.version,sha256:createHash('sha256').update(bytes).digest('hex'),status:'staged'});}const manifest={schemaVersion:1,sourceSha:process.env.GITHUB_SHA??'LOCAL-UNVERIFIED',createdAt:new Date().toISOString(),entries};await writeFile('release-manifest.json',`${JSON.stringify(manifest,null,2)}\n`);console.log(JSON.stringify(manifest,null,2));
