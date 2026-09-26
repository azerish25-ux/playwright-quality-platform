import { appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { input, integerInput } from './input.js';

async function append(path: string | undefined, value: string): Promise<void> {
  if (path) await appendFile(path, value);
  else process.stdout.write(value);
}

async function output(name: string, value: string): Promise<void> {
  await append(process.env.GITHUB_OUTPUT, `${name}<<FORGEQA_EOF\n${value}\nFORGEQA_EOF\n`);
}

async function summary(markdown: string): Promise<void> {
  await append(process.env.GITHUB_STEP_SUMMARY, markdown);
}

async function run(command: string, args: string[], cwd: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false, env: { ...process.env } });
    child.once('error', reject);
    child.once('exit', (code: number | null, signal: string | null) => resolve(signal ? 3 : code ?? 3));
  });
}

export async function main(): Promise<void> {
  const workingDirectory = input('working-directory') || '.';
  const suite = input('suite') || 'smoke';
  const browsers = input('browsers') || 'chromium';
  const workers = integerInput('workers', 1, 1, 128);
  const shardCount = integerInput('shard-count', 1, 1, 256);
  const shardIndex = integerInput('shard-index', 1, 1, shardCount);
  const args = [
    'packages/cli/dist/cli.js', 'run', '--suite', suite, '--browsers', browsers,
    '--workers', String(workers), '--shard', `${shardIndex}/${shardCount}`, '--json',
  ];
  const code = await run(process.execPath, args, workingDirectory);
  const outcome = code === 0 ? 'success' : code === 1 ? 'quality-failure' : 'infrastructure-failure';
  await output('outcome', outcome);
  await output('shard-index', String(shardIndex));
  await output('shard-count', String(shardCount));
  await summary(`# ForgeQA\n\n- Outcome: **${outcome}**\n- Suite: \`${suite}\`\n- Browsers: \`${browsers}\`\n- Shard: ${shardIndex}/${shardCount}\n`);
  if (code !== 0) process.exitCode = code;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 3;
  });
}
