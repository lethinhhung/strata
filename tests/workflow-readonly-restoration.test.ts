import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Removed unused import run
import { resumeRun, startRun } from '../src/workflow.js';
import { configuration, git, repository, savedRun, write } from './helpers/fixtures.js';
import { scriptedWorkflow, stage } from './helpers/workflow.js';

vi.mock('../src/provider.js', async (original) => ({ ...await original<typeof import('../src/provider.js')>(), invoke: vi.fn(), run: vi.fn() }));
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
const start = (repo: string, config = configuration(repo), epicFile = '(inline epic)') => startRun(repo, '  Fixture epic  ', epicFile, config);
// const failResult = { code: 1, stdout: '', stderr: 'controlled failure', timedOut: false };

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
