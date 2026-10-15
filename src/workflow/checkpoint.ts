import { run } from '../provider.js';

/**
 * Record a snapshot of the current stage by committing staged changes and pushing the branch.
 * If there are uncommitted changes, they are added and committed with a message derived from the stage title.
 * Errors are thrown with descriptive messages if add/commit or push fail.
 */
export async function checkpoint(repo: string, stage: { title: string; id?: string; status?: string }): Promise<void> {
  const status = await run('git', ['status', '--porcelain'], repo, 10000);
  if (status.stdout.trim()) {
    const added = await run('git', ['add', '-A'], repo, 10000);
    if (added.code !== 0) throw new Error(`Stage checkpoint add failed: ${added.stderr}`);
    const message = `strata: ${stage.title}`;
    const commit = await run('git', ['commit', '-m', message], repo, 60000);
    if (commit.code !== 0) throw new Error(`Stage checkpoint commit failed: ${commit.stderr}`);
  }
  const push = await pushCurrentBranch(repo);
  if (push.code !== 0) throw new Error(`Stage ${stage.id} committed but push failed: ${push.stderr}`);
}

// Internal helper used by both checkpoint and finalizeRecord.
async function pushCurrentBranch(repo: string) {
  const upstream = await run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repo, 10000);
  if (upstream.code === 0 && upstream.stdout.trim()) return run('git', ['push'], repo, 120000);

  const branchResult = await run('git', ['branch', '--show-current'], repo, 10000);
  const branch = branchResult.stdout.trim();
  if (!branch) return { code: 1, stdout: '', stderr: 'Cannot push because the current branch has no name.', timedOut: false };

  const configuredRemote = await run('git', ['config', '--get', `branch.${branch}.pushRemote`], repo, 10000);
  const defaultRemote = configuredRemote.code === 0
    ? configuredRemote.stdout.trim()
    : (await run('git', ['config', '--get', 'remote.pushDefault'], repo, 10000)).stdout.trim();
  const remotes = await run('git', ['remote'], repo, 10000);
  const availableRemotes = remotes.stdout.split('\n').map((remote) => remote.trim()).filter(Boolean);
  const remote = defaultRemote || (availableRemotes.includes('origin') ? 'origin' : availableRemotes[0]);
  if (!remote) return { code: 1, stdout: '', stderr: 'Cannot push because this repository has no configured remote.', timedOut: false };
  return run('git', ['push', '--set-upstream', remote, branch], repo, 120000);
}

// Export finalizeRecord for use by workflow.ts. It uses the internal pushCurrentBranch.
export async function finalizeRecord(repo: string) {
  const status = await run('git', ['status', '--porcelain'], repo, 10000);
  if (status.stdout.trim()) {
    await run('git', ['add', '-A'], repo, 10000);
    const commit = await run('git', ['commit', '-m', 'strata: record completed run'], repo, 60000);
    if (commit.code !== 0) throw new Error(`Final run checkpoint commit failed: ${commit.stderr}`);
  }
  const push = await pushCurrentBranch(repo);
  if (push.code !== 0) throw new Error(`Final run push failed: ${push.stderr}`);
}
