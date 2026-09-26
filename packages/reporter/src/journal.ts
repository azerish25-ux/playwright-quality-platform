import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { IntegrityError, sha256, stableStringify, type AttemptRecord, type ShardResult } from '@azerish25-ux/forgeqa-core';
export class ResultJournal {
  readonly path:string; readonly finalPath:string; #closed=false;
  constructor(path:string){this.path=path;this.finalPath=`${path}.final.json`;}
  async start(metadata:Omit<ShardResult,'attempts'|'completion'|'finalizedAt'|'journalSha256'>):Promise<void>{await mkdir(dirname(this.path),{recursive:true}); await writeFile(this.path,`${stableStringify({type:'header',...metadata})}\n`,{flag:'wx',mode:0o600});}
  async attempt(attempt:AttemptRecord):Promise<void>{if(this.#closed)throw new IntegrityError('Cannot append to a finalized journal.');await appendFile(this.path,`${stableStringify({type:'attempt',attempt})}\n`);}
  async finalize(result:ShardResult):Promise<void>{if(this.#closed)throw new IntegrityError('Journal already finalized.');this.#closed=true;const bytes=await readFile(this.path);const digest=sha256(bytes);const complete={...result,finalizedAt:new Date().toISOString(),journalSha256:digest};const temp=`${this.finalPath}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(complete,null,2)}\n`,{mode:0o600});await rename(temp,this.finalPath);}
}
export async function readFinalizedShard(path:string):Promise<ShardResult>{let parsed:ShardResult;try{parsed=JSON.parse(await readFile(path,'utf8')) as ShardResult;}catch(error){throw new IntegrityError(`Invalid shard report ${path}.`,{cause:error instanceof Error?error.message:String(error)});}if(!parsed.finalizedAt||!parsed.journalSha256)throw new IntegrityError(`Shard report ${path} lacks finalization evidence.`);return parsed;}
