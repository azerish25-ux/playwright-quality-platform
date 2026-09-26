import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,cp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

test('consumer probe imports import-only exports and uses the declared CLI binary',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'forgeqa-esm Ω '));
  try{
    await writeFile(join(dir,'package.json'),JSON.stringify({private:true,type:'module'}));
    for(const name of ['core','cli']){
      const pkg=join(dir,'node_modules','@azerish25-ux',`forgeqa-${name}`);await mkdir(join(pkg,'dist'),{recursive:true});
      await writeFile(join(pkg,'package.json'),JSON.stringify({name:`@azerish25-ux/forgeqa-${name}`,type:'module',exports:{'.':{import:'./dist/index.js'}},...(name==='cli'?{bin:{forgeqa:'./dist/executable.js'}}:{})}));
      await writeFile(join(pkg,'dist/index.js'),'export const verified = true;');
      if(name==='cli')await writeFile(join(pkg,'dist/executable.js'),'process.exitCode=0;');
    }
    assert.throws(()=>createRequire(join(dir,'package.json')).resolve('@azerish25-ux/forgeqa-core'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
    const probe=join(dir,'public-exports.mjs');await cp(fileURLToPath(new URL('./consumers/public-exports.mjs',import.meta.url)),probe);
    const child=spawnSync(process.execPath,[probe,'@azerish25-ux/forgeqa-core','@azerish25-ux/forgeqa-cli'],{cwd:dir,encoding:'utf8',timeout:10000});
    assert.ifError(child.error);assert.equal(child.status,0,child.stderr);
    const result=JSON.parse(child.stdout);assert.equal(Object.keys(result.entries).length,2);
    assert.equal(result.cli,join(await realpath(dir),'node_modules/@azerish25-ux/forgeqa-cli/dist/executable.js'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
