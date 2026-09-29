import { spawn } from 'node:child_process';
import { access, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** No shell interpolation; callers decide whether captured output is safe to retain. */
export function execute(command, args, { cwd = process.cwd(), env = process.env, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', length = 0, failure;
    const stop = reason => { failure ??= reason; child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop(new Error('Release subprocess exceeded its time budget.')), timeoutMs);
    for (const [stream, append] of [[child.stdout, s => { stdout += s; }], [child.stderr, s => { stderr += s; }]]) {
      stream.on('data', bytes => {
        length += bytes.length;
        if (length > 8 * 1024 * 1024) stop(new Error('Release subprocess exceeded its output budget.'));
        else append(bytes.toString());
      });
    }
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) {
        const error = new Error(`Release subprocess failed with exit code ${code}.`);
        // Deliberately non-enumerable: publication diagnostics must not serialize credentials.
        Object.defineProperties(error, { stdout: { value: stdout }, stderr: { value: stderr } });
        reject(error);
      } else resolve(stdout);
    });
  });
}

export async function npmCli() {
  const candidates = [process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  for (const path of candidates) {
    if (!path || !/npm-cli\.js$/.test(path)) continue;
    try { await access(path); return path; } catch { /* Try the next standard Node installation layout. */ }
  }
  throw new Error('Cannot locate the npm CLI; run through npm or install npm alongside Node.');
}
export async function runNpm(args, options) { return execute(process.execPath, [await npmCli(), ...args], options); }

export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync(); await handle.close(); handle = undefined;
    await rename(temporary, path);
  } finally { await handle?.close(); await rm(temporary, { force: true }); }
}
