import { execFileSync } from 'node:child_process';
import { RunError } from './types.js';
import * as utils from './utils.js';

export function finalizeRun(repo: string, record: any) {
  const branch = utils.git(repo, ['branch', '--show-current']).stdout.trim();
  if (!branch) throw new RunError('Cannot finalize a run without a named branch');
  const add = utils.git(repo, ['add', '-A'], { allowFailure: true });
  if (add.status !== 0) throw new RunError(`Could not stage completed run changes: ${add.stderr.trim()}`);
  if (utils.git(repo, ['diff', '--cached', '--quiet'], { allowFailure: true }).status !== 0) {
    const commit = utils.git(repo, ['commit', '-m', `strata: complete ${record.run_id}`], { allowFailure: true });
    if (commit.status !== 0) throw new RunError(`Could not commit completed run changes: ${commit.stderr.trim()}`);
  }
  const push = utils.git(repo, ['push', '-u', 'origin', branch], { allowFailure: true });
  if (push.status !== 0) throw new RunError(`Could not push completed run: ${(push.stderr || push.stdout).trim()}`);
  const dirty = utils.git(repo, ['status', '--porcelain']).stdout.trim();
  if (dirty) throw new RunError(`Completed run left a dirty worktree:\n${dirty}`);
  const existing = gh(repo, ['pr', 'view', branch, '--json', 'url,state', '--jq', 'select(.state == "OPEN") | .url']);
  if (existing.status === 0 && existing.stdout.trim()) return existing.stdout.trim();
  const created = gh(repo, ['pr', 'create', '--fill', '--head', branch]);
  if (created.status !== 0) throw new RunError(`Could not open a pull request: ${(created.stderr || created.stdout).trim()}`);
  return created.stdout.trim();
}

function gh(repo: string, args: string[]) {
  try {
    return { status: 0, stdout: execFileSync('gh', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) as string, stderr: '' };
  } catch (error) {
    const result = error as { status?: number; stdout?: string; stderr?: string };
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? String(error) };
  }
}
