import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { access, lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { IntegrityError, redactText } from '@azerish25-ux/forgeqa-core';

export interface NativeMergeResult {
  reportDirectory: string;
  htmlPath: string;
  jsonPath: string;
  runnerExitCode: number;
  diagnostics: string;
}
function playwrightCli(): string {
  const require = createRequire(resolve('package.json'));
  try { return require.resolve('@playwright/test/cli'); }
  catch { throw new IntegrityError('A compatible @playwright/test installation is required to merge native blob reports.'); }
}
function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(GITHUB_TOKEN|GH_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN)$/.test(key)) delete env[key];
  return env;
}
async function invokeMerge(cli: string, args: string[]): Promise<{ code: number; output: string }> {
  return await new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: process.cwd(), env: sanitizedEnvironment(), shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    timer.unref();
    child.stdout.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-65_536); });
    child.stderr.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-65_536); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); done({ code: code ?? 3, output: redactText(output) }); });
  });
}
async function requireRegularFile(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) throw new IntegrityError(`Native merged report is missing or invalid: ${path}`);
}

export async function mergeNativeBlobReports(blobDirectory: string, output: string): Promise<NativeMergeResult> {
  const input = resolve(blobDirectory);
  await access(input);
  const outputRoot = resolve(output);
  const reportDirectory = resolve(outputRoot, 'playwright-report');
  const htmlPath = resolve(reportDirectory, 'index.html');
  const jsonPath = resolve(reportDirectory, 'results.json');
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const configPath = resolve(outputRoot, `.forgeqa-native-merge-${process.pid}.mjs`);
  const source = `export default ${JSON.stringify({ reporter: [['html', { outputFolder: reportDirectory, open: 'never' }], ['json', { outputFile: jsonPath }]] }, null, 2)};\n`;
  await writeFile(configPath, source, { flag: 'wx', mode: 0o600 });
  let result: { code: number; output: string };
  try { result = await invokeMerge(playwrightCli(), ['merge-reports', `--config=${configPath}`, input]); }
  finally { await rm(configPath, { force: true }); }
  try { await requireRegularFile(htmlPath); await requireRegularFile(jsonPath); }
  catch (error) { throw new IntegrityError('Playwright blob merge did not produce complete HTML and JSON evidence.', { exitCode: result.code, diagnostics: result.output, cause: error instanceof Error ? error.message : String(error) }); }
  if (result.code !== 0 && result.code !== 1) throw new IntegrityError('Playwright blob merge failed.', { exitCode: result.code, diagnostics: result.output });
  await mkdir(dirname(jsonPath), { recursive: true });
  return { reportDirectory, htmlPath, jsonPath, runnerExitCode: result.code, diagnostics: result.output };
}
