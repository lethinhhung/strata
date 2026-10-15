import { spawn } from 'node:child_process';

interface RunOptions {
  idleTimeoutMs?: number;
  onStdout?: (chunk: Buffer) => string | void;
}

export function run(command: string, args: string[], cwd: string, timeout: number, env: NodeJS.ProcessEnv = process.env, options: RunOptions = {}): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; idleTimedOut?: boolean; aborted?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false, timedOut = false, idleTimedOut = false, aborted: string | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const terminate = (idle: boolean, failure?: string) => {
      if (settled || timedOut || aborted) return;
      timedOut = !failure; idleTimedOut = idle; aborted = failure;
      clearTimeout(timer); clearTimeout(idleTimer); child.kill('SIGTERM');
      escalation = setTimeout(() => child.kill('SIGKILL'), 2000); escalation.unref();
    };
    const timer = setTimeout(() => terminate(false), timeout);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      if (!settled && !timedOut && !aborted && options.idleTimeoutMs && options.idleTimeoutMs > 0) idleTimer = setTimeout(() => terminate(true), options.idleTimeoutMs);
    };
    resetIdleTimer();
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk); resetIdleTimer();
      const failure = options.onStdout?.(chunk);
      if (failure) terminate(false, failure);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); clearTimeout(idleTimer); clearTimeout(escalation); reject(error); } });
    child.on('close', (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(idleTimer); clearTimeout(escalation);
      resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), timedOut, ...(idleTimedOut ? { idleTimedOut: true } : {}), ...(aborted ? { aborted } : {}) });
    });
  });
}
