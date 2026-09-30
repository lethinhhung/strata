import { spawnSync } from 'node:child_process';
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

export function runChecks(repo: string, checks: WorkflowCheck[], prefix = '') {
  return checks.map((check) => {
    const result = spawnSync(check.command[0], check.command.slice(1), { cwd: repo, encoding: 'utf8', shell: false, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
    const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
    const unavailable = errorCode === 'ENOENT';
    const passed = result.status === 0;
    return {
      id: check.id,
      kind: prefix ? `${prefix}_${check.kind}` : check.kind,
      command: check.command,
      exit_code: result.status,
      signal: result.signal,
      stdout: (result.stdout ?? '').slice(-12_000),
      stderr: (result.stderr ?? '').slice(-12_000),
      ...(result.error ? { error: result.error.message, error_code: errorCode } : {}),
      passed,
      unavailable,
      unavailable_allowed: unavailable && check.allow_unavailable,
      unavailable_reason: check.allow_unavailable ? check.unavailable_reason : '',
      gate_passed: passed || (unavailable && check.allow_unavailable),
    };
  });
}
