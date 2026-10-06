import { spawn } from 'node:child_process';
import type { WorkflowCheck } from '../workflowConfig.js';

export function workflowChecks(workflow: any): WorkflowCheck[] {
  if (Array.isArray(workflow.checks) && (workflow.checks.length > 0 || (!workflow.test_commands?.length && !workflow.quality_checks?.length))) return workflow.checks;
  const tests = Array.isArray(workflow.test_commands) ? workflow.test_commands : [];
  const quality = Array.isArray(workflow.quality_checks) ? workflow.quality_checks : [];
  return [
    ...tests.map((command: string[], index: number) => ({ id: `test-${index + 1}`, kind: 'test' as const, command, allow_unavailable: false, unavailable_reason: '' })),
    ...quality.map((command: string[], index: number) => ({ id: `quality-${index + 1}`, kind: 'quality' as const, command, allow_unavailable: false, unavailable_reason: '' })),
  ];
}

export function setupChecks(workflow: any): WorkflowCheck[] {
  const commands = Array.isArray(workflow.setup_commands) ? workflow.setup_commands : [];
  return commands.map((command: string[], index: number) => ({
    id: `setup-${index + 1}`,
    kind: 'quality' as const,
    command,
    allow_unavailable: false,
    unavailable_reason: '',
  }));
}

export async function runChecks(repo: string, checks: WorkflowCheck[], prefix = '', concurrency = 1) {
  const results = new Array(checks.length);
  let next = 0;
  async function runNext() {
    while (next < checks.length) {
      const index = next++;
      results[index] = await runCheck(repo, checks[index], prefix);
    }
  }
  await Promise.all(Array.from({ length: Math.min(checks.length, concurrency) }, runNext));
  return results;
}

async function runCheck(repo: string, check: WorkflowCheck, prefix: string) {
  const started = performance.now();
  const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; error?: NodeJS.ErrnoException }>((resolve) => {
    const child = spawn(check.command[0], check.command.slice(1), { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    let error: NodeJS.ErrnoException | undefined;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    }, 10 * 60 * 1000);
    child.stdout.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-12_000); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-12_000); });
    child.on('error', (cause: NodeJS.ErrnoException) => { error = cause; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      if (timedOut) error = Object.assign(new Error('Command timed out after 600 seconds'), { code: 'ETIMEDOUT' });
      resolve({ status, signal, stdout, stderr, error });
    });
  });
  const duration_ms = performance.now() - started;
  const errorCode = result.error?.code;
  const unavailable = errorCode === 'ENOENT';
  const passed = result.status === 0 && !result.error;
  return {
    id: check.id,
    kind: prefix ? `${prefix}_${check.kind}` : check.kind,
    command: check.command,
    exit_code: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.error ? { error: result.error.message, error_code: errorCode } : {}),
    duration_ms,
    passed,
    unavailable,
    unavailable_allowed: unavailable && check.allow_unavailable,
    unavailable_reason: check.allow_unavailable ? check.unavailable_reason : '',
    gate_passed: passed || (unavailable && check.allow_unavailable),
  };
}
