// Executed from a copy inside the isolated consumer: resolution is relative
// to this module, never to the provider checkout or CommonJS require conditions.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,relative,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=await realpath(dirname(fileURLToPath(import.meta.url)));
async function owned(path){
  const canonical=await realpath(path),rel=relative(root,canonical);
  assert(rel!==''&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\')&&!isAbsolute(rel),'Public package must resolve inside the independent consumer.');
  return canonical;
}
const entries={};
for(const name of process.argv.slice(2)){
  const url=import.meta.resolve(name);
  entries[name]=await owned(fileURLToPath(url));
  const module=await import(name);
  assert(Object.keys(module).length>0,`${name} must expose a usable public API.`);
}
const cliRoot=dirname(dirname(entries['@azerish25-ux/forgeqa-cli']));
const metadata=JSON.parse(await readFile(resolve(cliRoot,'package.json'),'utf8'));
assert.equal(typeof metadata.bin?.forgeqa,'string','Published CLI must declare its executable.');
const cli=await owned(resolve(cliRoot,metadata.bin.forgeqa));
process.stdout.write(JSON.stringify({entries,cli})+'\n');
