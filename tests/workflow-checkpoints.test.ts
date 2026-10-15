import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/provider.js';
import { resumeRun, startRun } from '../src/workflow.js';
import { configuration, git, repository, savedRun, write } from './helpers/fixtures.js';
import { scriptedWorkflow, stage } from './helpers/workflow.js';

vi.mock('../src/provider.js', async (original) => ({ ...await original<typeof import('../src/provider.js')>(), invoke: vi.fn(), run: vi.fn() }));
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));

const start = (repo: string, config = configuration(repo), epicFile = '(inline epic)') => startRun(repo, '  Fixture epic  ', epicFile, config);
const failResult = { code: 1, stdout: '', stderr: 'controlled failure', timedOut: false };

describe('checkpoint failures and recovery', () => {
  it.each(['stage commit', 'stage push', 'final commit', 'final push'])('recovers %s before dependent work proceeds', async (failure) => {
    const { repo, remote } = repository();
    const { calls, actualRun } = await scriptedWorkflow([stage(), stage('second', ['first'])]);
    let failedOnce = false;
    vi.mocked(run).mockImplementation((command, args, cwd, timeout, env) => {
      const isCommit = command === 'git' && args[0] === 'commit';
      const isPush = command === 'git' && args[0] === 'push';
      const final = args.includes('strata: record completed run');
      const record = fs.existsSync(path.join(repo, 'docs', 'temps')) ? savedRun(repo) : undefined;
      const trigger = failure === 'stage commit' ? isCommit && !final : failure === 'stage push' ? isPush && record?.stages[0].status === 'checkpoint_pending' : failure === 'final commit' ? isCommit && final : isPush && record?.status === 'complete';
      if (!failedOnce && trigger) { failedOnce = true; return Promise.resolve(failResult); }
      return actualRun(command, args, cwd, timeout, env);
    });
    await expect(start(repo)).rejects.toThrow(failure.includes('commit') ? /commit failed/ : /push failed/);
    expect(failedOnce).toBe(true);
    const failed = savedRun(repo);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('controlled failure');
    if (failure.startsWith('stage')) {
      expect(failed.stages.map((item: { status: string }) => item.status)).toEqual(['checkpoint_pending', 'pending']);
      expect(calls.filter((call) => call.role === 'implementer').map((call) => call.stage?.id)).toEqual(['first']);
      expect(failed.history.some((event: { type: string }) => event.type === 'stage_complete')).toBe(false);
    } else expect(failed.stages.every((item: { status: string }) => item.status === 'complete')).toBe(true);
    const resumedScript = await scriptedWorkflow([stage(), stage('second', ['first'])], (call) => {
      if (call.role === 'implementer') {
        expect(call.stage?.id).toBe('second');
        expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(remote, 'rev-parse', 'refs/heads/work'));
      }
      return undefined;
    });
    const resumed = await resumeRun(repo, failed.id, configuration(repo));
    expect(resumed.status).toBe('complete');
    expect(resumed.stages[0].attempts).toHaveLength(1);
    expect(resumedScript.calls.filter((call) => call.role === 'archivist' && call.stage?.id === 'first')).toHaveLength(0);
    if (failure.startsWith('final')) expect(resumedScript.calls).toEqual([]);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(remote, 'rev-parse', 'refs/heads/work'));
  });
  it('retries a pending push even when a committed checkpoint has a clean worktree', async () => {
    const { repo, remote } = repository();
    await scriptedWorkflow([stage(), stage('second', ['first'])]);
    const record = await start(repo);
    record.status = 'failed';
    record.stages[0].status = 'checkpoint_pending';
    record.stages[1].status = 'pending';
    write(repo, `docs/temps/${record.id}.json`, `${JSON.stringify(record)}\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'pending checkpoint fixture');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    await scriptedWorkflow([stage(), stage('second', ['first'])], (call) => {
      if (call.role === 'implementer') expect(git(remote, 'log', '--all', '--format=%s')).toContain('pending checkpoint fixture');
      return undefined;
    });
    const actual = await vi.importActual<typeof import('../src/provider.js')>('../src/provider.js');
    let cleanCheckpointStatus = false;
    vi.mocked(run).mockImplementation((command, args, cwd, timeout, env) => {
      if (!cleanCheckpointStatus && command === 'git' && args[0] === 'status' && savedRun(repo).stages[0].status === 'checkpoint_pending') {
        cleanCheckpointStatus = true;
        return Promise.resolve({ code: 0, stdout: '', stderr: '', timedOut: false });
      }
      return actual.run(command, args, cwd, timeout, env);
    });
    expect((await resumeRun(repo, record.id, configuration(repo))).status).toBe('complete');
    expect(cleanCheckpointStatus).toBe(true);
  });
});
