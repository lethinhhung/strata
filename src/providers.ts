import { spawn } from 'node:child_process';

export class ProviderError extends Error {}

interface Model {
  provider: string;
  model: string;
  command: string;
  timeout_seconds: number;
  extra_args: string[];
}

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

function run(command: string, args: string[], { cwd, timeout }: { cwd: string; timeout: number }): Promise<{ code: number | null; signal: NodeJS.Signals | null | undefined; timedOut: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    let timedOut = false;
    let settled = false;
    let exitTimer: NodeJS.Timeout;
    const finish = (code: number | null, signal: NodeJS.Signals | null | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(exitTimer);
      resolve({ code, signal, timedOut, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    }, timeout);
    child.stdout.on('data', (chunk: Uint8Array) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Uint8Array) => stderr.push(chunk));
    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(exitTimer);
      reject(error);
    });
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null | undefined) => {
      exitTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(code, signal);
      }, 1000);
    });
    child.on('close', finish);
  });
}

export async function invoke(model: Model, prompt: string, cwd: string, role: string, { skipGitRepoCheck = false } = {}): Promise<string> {
  let args: string[];
  const provider = model.provider.toLowerCase();
  if (provider === 'codex') {
    args = ['exec', '--json', '--cd', cwd, '--sandbox', 'workspace-write', '--config', 'approval_policy="never"'];
    if (skipGitRepoCheck) args.push('--skip-git-repo-check');
    if (model.model) args.push('--model', model.model);
    args.push(...model.extra_args, prompt);
  } else if (provider === 'opencode') {
    args = ['run', '--format', 'json', '--dir', cwd];
    if (model.model) args.push('--model', model.model);
    args.push(...model.extra_args, prompt);
  } else {
    throw new ProviderError(`Unsupported CLI provider ${model.provider}; use codex or opencode`);
  }
  let result: { code: number | null; signal: NodeJS.Signals | null | undefined; timedOut: boolean; stdout: string; stderr: string } = {
    code: 1, signal: null, timedOut: false, stdout: '', stderr: '',
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await run(model.command, args, { cwd, timeout: model.timeout_seconds * 1000 });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new ProviderError(`Cannot find \`${model.command}\` for ${role}`);
      throw new ProviderError(`${role} process failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.code === 0 && !result.timedOut) break;
    const failure = `${result.stderr}\n${result.stdout}`;
    const transient = /unexpected server error|temporarily overloaded|service unavailable|\b503\b|\b429\b/i.test(failure);
    // Explore is read-only, so retrying its transient provider failures is safe.
    if (role !== 'Explore Agent' || !transient || attempt === 2) {
      if (result.timedOut) throw new ProviderError(`${role} timed out after ${model.timeout_seconds}s`);
      throw new ProviderError(`${role} exited ${result.code}: ${(result.stderr || result.stdout).slice(-4000)}`);
    }
    await sleep(500 * (attempt + 1));
  }
  if (result.timedOut) throw new ProviderError(`${role} timed out after ${model.timeout_seconds}s`);
  if (result.code !== 0) throw new ProviderError(`${role} exited ${result.code}: ${(result.stderr || result.stdout).slice(-4000)}`);
  return provider === 'codex' ? parseCodexOutput(result.stdout) : parseOpenCodeOutput(result.stdout);
}

function parseCodexOutput(stdout: string): string {
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') messages.push(event.item.text ?? '');
      if (event.type === 'response.completed' && event.response?.output_text) messages.push(event.response.output_text);
    } catch { /* Ignore non-JSON CLI progress lines. */ }
  }
  return messages.at(-1) ?? stdout.trim();
}

function parseOpenCodeOutput(stdout: string): string {
  const lines = stdout.trim().split(/\r?\n/);
  const parts: string[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.part?.text) parts.push(event.part.text);
      else if (event.text) parts.push(event.text);
      else if (event.type === 'text' && event.content) parts.push(event.content);
    } catch { /* Ignore non-JSON CLI diagnostics and keep parsing event lines. */ }
  }
  return parts.length ? parts.join('\n') : stdout.trim();
}
