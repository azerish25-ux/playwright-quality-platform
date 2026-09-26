import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('dist/public',{recursive:true});
await build({entryPoints:['src/app.tsx'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/public/app.js',minify:true,define:{'process.env.NODE_ENV':'"production"'},legalComments:'linked'});
await build({entryPoints:['src/server.ts'],bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',outfile:'dist/server.js'});
await writeFile('dist/public/index.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TeamBoard · ForgeQA reference consumer</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
