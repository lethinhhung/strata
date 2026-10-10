import { spawn } from 'node:child_process';
import { isTransientFailure, isTransientProviderEvent, retryDelay } from './providerRetry.js';
import { parseCodexOutput, parseOpenCodeOutput } from './providers/parse.js';
export class ProviderError extends Error {}
interface Model { provider: string; model: string; command: string; timeout_seconds: number; extra_args: string[]; }
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
function run(command: string, args: string[], { cwd, timeout, stopOnTransientEvents }: { cwd: string; timeout: number; stopOnTransientEvents?: boolean }): Promise<{ code: number | null; signal: NodeJS.Signals | null | undefined; timedOut: boolean; stdout: string; stderr: string; transientFailure?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const stdout: Uint8Array[] = []; const stderr: Uint8Array[] = [];
    let timedOut = false; let settled = false; let eventBuffer = ''; let logBuffer = '';
    let transientEvents = 0; let transientFailure: string | undefined; let exitTimer: NodeJS.Timeout;
    const finish = (code: number | null, signal: NodeJS.Signals | null | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(exitTimer);
      resolve({ code, signal, timedOut, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), transientFailure });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    }, timeout);
    child.stdout.on('data', (chunk: Uint8Array) => {
      stdout.push(chunk);
      inspectLines(chunk, 'event');
    });
    child.stderr.on('data', (chunk: Uint8Array) => { stderr.push(chunk); inspectLines(chunk, 'log'); });
    function inspectLines(chunk: Uint8Array, source: 'event' | 'log') {
      if (!stopOnTransientEvents || transientFailure) return;
      let buffer = source === 'event' ? eventBuffer : logBuffer;
      buffer += Buffer.from(chunk).toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      if (source === 'event') eventBuffer = buffer; else logBuffer = buffer;
      for (const line of lines) {
        const transient = source === 'event' ? isTransientProviderEvent(line) : isTransientFailure(line);
        if (transient && ++transientEvents >= 3) {
          transientFailure = line;
          child.kill('SIGTERM');
          break;
        }
      }
    }
    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(exitTimer);
      reject(error);
    });
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null | undefined) => {
      exitTimer = setTimeout(() => {
        child.stdout.destroy(); child.stderr.destroy();
        finish(code, signal);
      }, 1000);
    });
    child.on('close', finish);
  });
}
export async function invoke(model: Model, prompt: string, cwd: string, role: string, { skipGitRepoCheck = false } = {}): Promise<{
  text: string; model?: string; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number;
}> {
  let args: string[];
  const provider = model.provider.toLowerCase();
  if (provider === 'codex') {
    args = ['exec', '--json', '--cd', cwd, '--sandbox', 'workspace-write', '--config', 'approval_policy="never"'];
    if (skipGitRepoCheck) args.push('--skip-git-repo-check');
    if (model.model) args.push('--model', model.model);
    args.push(...model.extra_args, prompt);
  } else if (provider === 'opencode') {
    args = ['run', '--format', 'json', '--print-logs', '--log-level', 'ERROR', '--dir', cwd];
    if (model.model) args.push('--model', model.model);
    args.push(...model.extra_args, prompt);
  } else {
    throw new ProviderError(`Unsupported CLI provider ${model.provider}; use codex or opencode`);
  }
  let result: { code: number | null; signal: NodeJS.Signals | null | undefined; timedOut: boolean; stdout: string; stderr: string; transientFailure?: string } = {
    code: 1, signal: null, timedOut: false, stdout: '', stderr: '',
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      result = await run(model.command, args, { cwd, timeout: model.timeout_seconds * 1000, stopOnTransientEvents: provider === 'opencode' });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new ProviderError(`Cannot find \`${model.command}\` for ${role}`);
      throw new ProviderError(`${role} process failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.code === 0 && !result.timedOut) {
      const response = provider === 'codex' ? parseCodexOutput(result.stdout) : parseOpenCodeOutput(result.stdout);
      if (response.text.trim()) return response;
      result = { ...result, code: 1, stderr: 'Provider returned no agent text response' };
    }
    const failure = `${result.transientFailure ?? ''}\n${result.stderr}\n${result.stdout}`;
    if (!isTransientFailure(failure) || attempt === 3) {
      if (result.timedOut) throw new ProviderError(`${role} timed out after ${model.timeout_seconds}s`);
      throw new ProviderError(`${role} exited ${result.code}: ${(result.stderr || result.stdout).slice(-4000)}`);
    }
    await sleep(retryDelay(attempt, failure));
  }
  return { text: '' };
}
