import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { RunError } from './types.js';
import * as utils from './utils.js';

export function finalizeRun(repo: string, record: any, file: string) {
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
  let pullRequest = existing.stdout.trim();
  if (existing.status !== 0 || !pullRequest) {
    const created = gh(repo, ['pr', 'create', '--fill', '--head', branch]);
    if (created.status !== 0) throw new RunError(`Could not open a pull request: ${(created.stderr || created.stdout).trim()}`);
    pullRequest = created.stdout.trim();
  }

  record.pull_request = pullRequest;
  record.status = 'complete';
  record.completed_at = utils.now();
  record.progress.push({ type: 'run', subtype: 'complete', timestamp: record.completed_at });
  try {
    utils.save(record, file, false);
    const recordPath = path.relative(repo, file);
    const addRecord = utils.git(repo, ['add', '--', recordPath], { allowFailure: true });
    if (addRecord.status !== 0) throw new RunError(`Could not stage completed run record: ${addRecord.stderr.trim()}`);
    if (utils.git(repo, ['diff', '--cached', '--quiet'], { allowFailure: true }).status !== 0) {
      const commit = utils.git(repo, ['commit', '-m', `strata: record completion ${record.run_id}`], { allowFailure: true });
      if (commit.status !== 0) throw new RunError(`Could not commit completed run record: ${commit.stderr.trim()}`);
    }
    const finalPush = utils.git(repo, ['push', 'origin', branch], { allowFailure: true });
    if (finalPush.status !== 0) throw new RunError(`Could not push completed run record: ${(finalPush.stderr || finalPush.stdout).trim()}`);
  } catch (error) {
    record.status = 'running';
    delete record.completed_at;
    if (record.progress.at(-1)?.type === 'run' && record.progress.at(-1)?.subtype === 'complete') record.progress.pop();
    utils.save(record, file);
    throw error;
  }
  utils.save(record, file);
  const finalDirty = utils.git(repo, ['status', '--porcelain']).stdout.trim();
  if (finalDirty) throw new RunError(`Completed run left a dirty worktree:\n${finalDirty}`);
  return pullRequest;
}

function gh(repo: string, args: string[]) {
  try {
    return { status: 0, stdout: execFileSync('gh', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) as string, stderr: '' };
  } catch (error) {
    const result = error as { status?: number; stdout?: string; stderr?: string };
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? String(error) };
  }
}
