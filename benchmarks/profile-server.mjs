import { spawn } from 'node:child_process';
import { setTimeout as backoff } from 'node:timers/promises';
import { TimingRecorder } from '@azerish25-ux/forgeqa-core';

// Used only by the benchmark configuration; native Playwright still owns webServer.
const context = process.env.FORGEQA_TIMING_CONTEXT;
if (!context) throw new Error('Profiling server requires its owned timing context.');
const recorder = new TimingRecorder(context, 'application');
const origin = new URL(process.env.TEAMBOARD_ORIGIN ?? 'http://127.0.0.1:3199');
if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.username || origin.password) throw new Error('Benchmark readiness must target the local synthetic application.');
const started = recorder.now();
const child = spawn(process.execPath, ['dist/server.js'], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'inherit', 'inherit'], shell: false, detached: process.platform !== 'win32' });
let ready = false, shutdownStart, failed = false, forced = false, forceTimer;
const abort = new AbortController();
const signal = value => {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  try { if (process.platform === 'win32') child.kill(value); else process.kill(-child.pid, value); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
};
const stop = () => {
  if (shutdownStart !== undefined) return;
  shutdownStart = recorder.now();
  abort.abort();
  signal('SIGTERM');
  forceTimer = setTimeout(() => { forced = true; signal('SIGKILL'); }, 4000);
};
process.once('SIGTERM', stop); process.once('SIGINT', stop);
const deadline = setTimeout(() => { failed = true; stop(); }, 30000);
const closed = new Promise(resolve => {
  child.once('error', () => { failed = true; resolve({ code: null, signal: null }); });
  child.once('close', (code, childSignal) => resolve({ code, signal: childSignal }));
});
const readiness = (async () => {
  try {
    let delay = 20;
    while (!abort.signal.aborted) {
      try {
        const response = await fetch(new URL('/ready', origin), { redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1000)]) });
        const ok = response.status === 200;
        await response.body?.cancel();
        if (ok) {
          recorder.span('applicationReadiness', started);
          ready = true; clearTimeout(deadline); return;
        }
      } catch (error) { if (abort.signal.aborted) return; }
      // Bounded readiness polling, not synchronization sleeps inside application tests.
      await backoff(delay, undefined, { signal: abort.signal });
      delay = Math.min(200, delay * 2);
    }
  } catch { if (!abort.signal.aborted) { failed = true; stop(); } }
})();
try {
  const result = await closed;
  abort.abort();
  await readiness;
  if (shutdownStart !== undefined) recorder.span('applicationShutdown', shutdownStart);
  recorder.finish(ready && shutdownStart !== undefined && !failed && !forced && result.code === 0);
  process.exitCode = ready && shutdownStart !== undefined && !failed && !forced && result.code === 0 ? 0 : 3;
} finally {
  clearTimeout(deadline); clearTimeout(forceTimer);
  process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
  signal('SIGKILL');
}
