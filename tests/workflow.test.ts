import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/provider.js';
import { resumeRun, startRun } from '../src/workflow.js';
import { configuration, git, repository, savedRun, temporaryDirectory, write } from './helpers/fixtures.js';
import { scriptedWorkflow, stage } from './helpers/workflow.js';

vi.mock('../src/provider.js', async (original) => ({ ...await original<typeof import('../src/provider.js')>(), invoke: vi.fn(), run: vi.fn() }));
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
const start = (repo: string, config = configuration(repo), epicFile = '(inline epic)') => startRun(repo, '  Fixture epic  ', epicFile, config);
const failResult = { code: 1, stdout: '', stderr: 'controlled failure', timedOut: false };

describe('repository preconditions', () => {
  it('rejects a non-Git directory before creating run files', async () => {
    const repo = temporaryDirectory();
    const { calls } = await scriptedWorkflow();
    await expect(start(repo)).rejects.toThrow(/not a Git worktree/);
    expect(calls).toEqual([]);
    expect(fs.existsSync(path.join(repo, 'prompt'))).toBe(false);
  });
  it('rejects detached HEAD', async () => {
    const { repo } = repository();
    git(repo, 'checkout', '--detach');
    await scriptedWorkflow();
    await expect(start(repo)).rejects.toThrow(/named current branch/);
    expect(fs.existsSync(path.join(repo, 'docs'))).toBe(false);
  });
  it.each(['tracked', 'untracked', 'unselected epic'])('rejects unrelated %s changes', async (kind) => {
    const { repo } = repository();
    write(repo, kind === 'tracked' ? 'README.md' : kind === 'untracked' ? 'unexpected.txt' : 'other-epic.md', 'dirty');
    await scriptedWorkflow();
    await expect(start(repo)).rejects.toThrow(/must be clean/);
    expect(fs.existsSync(path.join(repo, 'prompt'))).toBe(false);
  });
  it('permits the selected epic and configuration changes on the current branch', async () => {
    const { repo } = repository();
    write(repo, 'epic.md', 'original');
    write(repo, '.strata.toml', '[workflow]\nimplement_fix_attempts=2\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'inputs');
    write(repo, 'epic.md', 'changed selected epic');
    write(repo, '.strata.toml', '[workflow]\nimplement_fix_attempts=1\n');
    await scriptedWorkflow();
    const record = await start(repo, configuration(repo), path.join(repo, 'epic.md'));
    expect(record.status).toBe('complete');
    expect(record.branch).toBe('work');
    expect(git(repo, 'branch', '--show-current')).toBe('work');
    expect(fs.readFileSync(path.join(repo, 'prompt', 'epic.md'), 'utf8')).toBe('Fixture epic\n');
  });
});

describe('check discovery', () => {
  const scripts = { 'test:ci': 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"', typecheck: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' };
  function metadata(repo: string, contents: string) {
    write(repo, 'package.json', contents);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'metadata');
  }
  it('configured checks override discovery and execute harmless real local commands twice', async () => {
    const { repo } = repository();
    metadata(repo, JSON.stringify({ scripts }));
    await scriptedWorkflow();
    const config = configuration(repo);
    config.workflow.checks = [[process.execPath, '-e', 'process.stdout.write("configured check")']];
    const record = await start(repo, config);
    const checks = record.stages[0].attempts![0].checks;
    expect(checks).toEqual([{ command: config.workflow.checks[0], code: 0, output: 'configured check\n' }]);
    expect(vi.mocked(run).mock.calls.filter(([command]) => command === process.execPath)).toHaveLength(2);
    expect(vi.mocked(run).mock.calls.some(([command]) => ['npm', 'pnpm', 'yarn', 'bun'].includes(command))).toBe(false);
  });
  it.each([
    [undefined, 'npm'], ['package-lock.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'],
  ])('discovers test:ci then lint/typecheck/build for lockfile %s', async (lockfile, manager) => {
    const { repo } = repository();
    if (lockfile) write(repo, lockfile, '{}');
    metadata(repo, JSON.stringify({ scripts }));
    const { actualRun } = await scriptedWorkflow();
    vi.mocked(run).mockImplementation((command, args, cwd, timeout, env) => ['npm', 'pnpm', 'yarn', 'bun'].includes(command)
      ? Promise.resolve({ code: 0, stdout: 'harmless mocked check', stderr: '', timedOut: false })
      : actualRun(command, args, cwd, timeout, env));
    const record = await start(repo);
    const expected = ['test:ci', 'lint', 'typecheck', 'build'].map((name) => [manager, 'run', name]);
    expect(record.stages[0].attempts![0].checks.map((check: { command: string[] }) => check.command)).toEqual(expected);
    expect(vi.mocked(run).mock.calls.filter(([command]) => command === manager).map(([command, args]) => [command, ...args])).toEqual([...expected, ...expected]);
  });
  it('falls back to test and runs discovered npm scripts in the disposable repository', async () => {
    const { repo } = repository();
    const fallback: Record<string, string> = { ...scripts };
    delete fallback['test:ci'];
    metadata(repo, JSON.stringify({ scripts: fallback }));
    await scriptedWorkflow();
    const record = await start(repo);
    expect(record.stages[0].attempts![0].checks.map((check: { command: string[] }) => check.command)).toEqual(['test', 'lint', 'typecheck', 'build'].map((name) => ['npm', 'run', name]));
  });
  it.each([undefined, '{bad', '{}', 'null', '{"scripts":null}', '{"scripts":42}'])('handles absent or malformed package metadata %s', async (contents) => {
    const { repo } = repository();
    if (contents !== undefined) metadata(repo, contents);
    await scriptedWorkflow();
    const record = await start(repo);
    expect(record.stages[0].attempts![0].checks).toEqual([]);
  });
});

describe('stages, failures, and resumable attempts', () => {
  it('checkpoints and archives stages in dependency order to a local remote', async () => {
    const { repo, remote } = repository();
    const { calls } = await scriptedWorkflow([stage(), stage('second', ['first'])], (call) => {
      if (call.role === 'implementer' && call.stage?.id === 'second') {
        expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(remote, 'rev-parse', 'refs/heads/work'));
        expect(savedRun(repo).stages[0].status).toBe('complete');
      }
      return undefined;
    });
    const record = await start(repo);
    expect(record.status).toBe('complete');
    expect(record.stages.map((item) => item.status)).toEqual(['complete', 'complete']);
    expect(calls.filter((call) => call.role === 'implementer').map((call) => call.stage?.id)).toEqual(['first', 'second']);
    expect(calls.filter((call) => call.role === 'archivist')).toHaveLength(2);
    expect(calls.filter((call) => ['epic coordinator', 'explore agent', 'stage coordinator', 'validator'].includes(call.role)).every((call) => call.readOnly)).toBe(true);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(remote, 'rev-parse', 'refs/heads/work'));
    expect(git(repo, 'log', '--format=%s')).toContain('strata: first');
    expect(git(repo, 'log', '--format=%s')).toContain('strata: second');
    expect(fs.readFileSync(path.join(repo, 'memory', 'second.md'), 'utf8')).toContain('durable notes');
  });
  it.each([[['absent']], [['second']]])('rejects missing or incomplete dependency %s before implementation', async (dependencies) => {
    const { repo } = repository();
    const { calls } = await scriptedWorkflow([stage('first', dependencies), stage('second')]);
    await expect(start(repo)).rejects.toThrow(/incomplete dependencies/);
    expect(calls.some((call) => call.role === 'implementer')).toBe(false);
    expect(savedRun(repo)).toMatchObject({ status: 'failed', error: expect.stringContaining('incomplete dependencies') });
    await expect(resumeRun(repo, savedRun(repo).id, configuration(repo))).rejects.toThrow(/incomplete dependencies/);
    expect(calls.some((call) => call.role === 'implementer')).toBe(false);
  });
  it.each(['check', 'tester', 'tester process', 'validator', 'validator process', 'implementer'])(
    'persists bounded %s failure and skips archive/checkpoint', async (failure) => {
      const { repo } = repository();
      const config = configuration(repo);
      config.workflow.implement_fix_attempts = 2;
      const { calls, actualRun } = await scriptedWorkflow([stage()], (call) => {
        if (failure === 'implementer' && call.role === 'implementer') throw new Error('implementer failure');
        if (call.role === failure) return JSON.stringify({ status: 'fail', findings: [`${failure} regression finding`], summary: 'Concrete mismatch' });
        if (`${call.role} process` === failure || (failure === 'implementer' && call.role === 'implementer')) throw new Error(`${failure} failure`);
        return undefined;
      });
      if (failure === 'check') {
        config.workflow.checks = ['fixture-check'].map((command) => [command]);
        vi.mocked(run).mockImplementation((command, args, cwd, timeout, env) => command === 'fixture-check' ? Promise.resolve(failResult) : actualRun(command, args, cwd, timeout, env));
      }
      await expect(start(repo, config)).rejects.toThrow(/after 2 implement\/fix attempts/);
      const record = savedRun(repo);
      expect(record.status).toBe('failed');
      expect(record.error).toContain('after 2');
      expect(record.stages[0].status).not.toBe('complete');
      expect(record.stages[0].attempts.map((attempt: { passed: boolean; attempt: number }) => [attempt.attempt, attempt.passed])).toEqual([[1, false], [2, false]]);
      expect(JSON.stringify(record.stages[0].attempts)).toContain(failure === 'check' ? 'controlled failure' : failure);
      expect(record.history.filter((event: { type: string }) => event.type === 'stage_attempt')).toHaveLength(2);
      expect(calls.filter((call) => call.role === 'stage coordinator')[1].prompt).toContain(failure === 'check' ? 'controlled failure' : failure);
      expect(calls.some((call) => call.role === 'archivist')).toBe(false);
      expect(record.history.some((event: { type: string }) => ['archive', 'stage_complete'].includes(event.type))).toBe(false);
      expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('1');
      expect(fs.existsSync(path.join(repo, 'memory'))).toBe(false);
    },
  );
  it('uses three attempts by default and resumes with prior findings without a lifetime retry cap', async () => {
    const { repo } = repository();
    const config = configuration(repo);
    await scriptedWorkflow([stage()], (call) => call.role === 'validator' ? JSON.stringify({ status: 'fail', findings: ['preserve this mismatch'], summary: 'Mismatch' }) : undefined);
    await expect(start(repo, config)).rejects.toThrow(/after 3/);
    const failed = savedRun(repo);
    expect(failed.stages[0].attempts).toHaveLength(3);
    const { calls } = await scriptedWorkflow();
    const resumed = await resumeRun(repo, failed.id, config);
    expect(resumed.status).toBe('complete');
    expect(resumed.error).toBeUndefined();
    expect(resumed.stages[0].attempts).toHaveLength(4);
    expect(resumed.stages[0].attempts!.at(-1).attempt).toBe(1);
    expect(calls.find((call) => call.role === 'stage coordinator')?.prompt).toContain('preserve this mismatch');
    expect(calls.find((call) => call.role === 'implementer')?.prompt).toContain('preserve this mismatch');
    expect(resumed.stages[0].attempts![0].validation.findings).toContain('preserve this mismatch');
  });
  it('resumes a failed dependent stage and skips an already checkpointed stage', async () => {
    const { repo } = repository();
    const config = configuration(repo);
    config.workflow.implement_fix_attempts = 1;
    await scriptedWorkflow([stage(), stage('second', ['first'])], (call) => call.role === 'validator' && call.stage?.id === 'second' ? '{"status":"fail","findings":["second mismatch"]}' : undefined);
    await expect(start(repo, config)).rejects.toThrow(/Stage second/);
    const failed = savedRun(repo);
    expect(failed.stages[0].status).toBe('complete');
    const { calls } = await scriptedWorkflow();
    const resumed = await resumeRun(repo, failed.id, config);
    expect(resumed.status).toBe('complete');
    expect(calls.filter((call) => call.stage).every((call) => call.stage?.id === 'second')).toBe(true);
    expect(resumed.stages[0].attempts).toHaveLength(1);
    expect(resumed.stages[1].attempts).toHaveLength(2);
  });
  it('records blocked planning and replans successfully on resume', async () => {
    const { repo } = repository();
    await scriptedWorkflow([], (call) => call.role === 'epic coordinator' && !call.prompt.includes('## task\nIdentify') ? '{"blockers":["need requirement"],"stages":[]}' : undefined);
    const record = await start(repo);
    expect(record.status).toBe('blocked');
    expect(savedRun(repo).blockers).toEqual(['need requirement']);
    await scriptedWorkflow();
    const resumed = await resumeRun(repo, `${record.id}.json`, configuration(repo));
    expect(resumed.status).toBe('complete');
    expect(resumed.blockers).toEqual([]);
    expect(resumed.history.some((event) => event.type === 'blocked')).toBe(true);
  });
  it('rejects missing and foreign run records and returns completed records without provider calls', async () => {
    const { repo } = repository();
    const { calls } = await scriptedWorkflow();
    await expect(resumeRun(repo, 'absent', configuration(repo))).rejects.toThrow(/not found/);
    const record = await start(repo);
    const file = path.join(repo, 'docs', 'temps', `${record.id}.json`);
    calls.splice(0);
    expect(await resumeRun(repo, file, configuration(repo))).toMatchObject({ status: 'complete' });
    expect(calls).toEqual([]);
    write(repo, 'foreign.json', JSON.stringify({ ...record, repo: temporaryDirectory() }));
    await expect(resumeRun(repo, 'foreign.json', configuration(repo))).rejects.toThrow(/another repository/);
  });
});

describe('read-only restoration', () => {
  it('preserves an existing staged/unstaged split when the validator changes the index', async () => {
    const { repo } = repository();
    const config = configuration(repo);
    config.workflow.implement_fix_attempts = 1;
    let index: Buffer | undefined;
    await scriptedWorkflow([stage()], (call) => {
      if (call.role === 'implementer') {
        write(repo, 'README.md', 'staged implementation');
        git(repo, 'add', 'README.md');
        write(repo, 'README.md', 'unstaged implementation');
        return 'Implemented staged and unstaged changes';
      }
      if (call.role === 'validator') {
        index = fs.readFileSync(path.join(repo, '.git', 'index'));
        write(repo, 'README.md', 'validator mutation');
        git(repo, 'add', '-A');
        throw new Error('validator process failed');
      }
      return undefined;
    });
    await expect(start(repo, config)).rejects.toThrow(/did not pass/);
    expect(fs.readFileSync(path.join(repo, '.git', 'index'))).toEqual(index);
    expect(git(repo, 'show', ':README.md')).toBe('staged implementation');
    expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe('unstaged implementation');
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('README.md');
    expect(git(repo, 'diff', '--name-only')).toBe('README.md');
  });
  it.each([false, true])('restores files, modes, links, and index even when provider rejects=%s', async (reject) => {
    const { repo } = repository();
    write(repo, 'changed.txt', 'original');
    write(repo, 'deleted.txt', 'restore me');
    write(repo, 'executable.sh', '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(repo, 'executable.sh'), 0o755);
    fs.symlinkSync('changed.txt', path.join(repo, 'link'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'read-only fixtures');
    let index: Buffer | undefined;
    await scriptedWorkflow([stage()], (call) => {
      if (call.role !== 'epic coordinator') return undefined;
      index = fs.readFileSync(path.join(repo, '.git', 'index'));
      write(repo, 'changed.txt', 'mutated');
      fs.unlinkSync(path.join(repo, 'deleted.txt'));
      fs.chmodSync(path.join(repo, 'executable.sh'), 0o644);
      fs.unlinkSync(path.join(repo, 'link'));
      fs.symlinkSync('deleted.txt', path.join(repo, 'link'));
      write(repo, 'added.txt', 'unauthorized');
      git(repo, 'add', '-A');
      if (reject) throw new Error('provider rejection after mutation');
      return '{"exploration_tasks":[]}';
    });
    await expect(start(repo)).rejects.toThrow(/read-only.*reverted/);
    expect(fs.readFileSync(path.join(repo, 'changed.txt'), 'utf8')).toBe('original');
    expect(fs.readFileSync(path.join(repo, 'deleted.txt'), 'utf8')).toBe('restore me');
    expect(fs.statSync(path.join(repo, 'executable.sh')).mode & 0o777).toBe(0o755);
    expect(fs.readlinkSync(path.join(repo, 'link'))).toBe('changed.txt');
    expect(fs.existsSync(path.join(repo, 'added.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(repo, '.git', 'index'))).toEqual(index);
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(repo, 'diff', '--name-only')).toBe('');
    expect(savedRun(repo)).toMatchObject({ status: 'failed', error: expect.stringContaining('read-only') });
  });
  it('records a validator mutation followed by rejection as a failed attempt after restoring it', async () => {
    const { repo } = repository();
    const config = configuration(repo);
    config.workflow.implement_fix_attempts = 1;
    await scriptedWorkflow([stage()], (call) => {
      if (call.role === 'validator') {
        write(repo, 'README.md', 'unauthorized validator mutation');
        throw new Error('validator rejected');
      }
      return undefined;
    });
    await expect(start(repo, config)).rejects.toThrow(/did not pass/);
    expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe('Disposable regression repository.\n');
    expect(savedRun(repo).stages[0].attempts[0].validation.findings).toEqual([expect.stringContaining('reverted')]);
  });
  it('preserves a provider rejection without mutation and remains resumable', async () => {
    const { repo } = repository();
    await scriptedWorkflow([], () => { throw new Error('planning provider failed'); });
    await expect(start(repo)).rejects.toThrow('planning provider failed');
    const failed = savedRun(repo);
    expect(failed.error).toBe('planning provider failed');
    await scriptedWorkflow();
    expect((await resumeRun(repo, failed.id, configuration(repo))).status).toBe('complete');
  });
});

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
    // Resume saves running state; model the already committed checkpoint being retried.
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
