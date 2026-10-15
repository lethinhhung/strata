import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Removed unused import run
import { startRun } from '../src/workflow.js';
import { configuration, git, repository, temporaryDirectory, write } from './helpers/fixtures.js';
import { scriptedWorkflow } from './helpers/workflow.js';

vi.mock('../src/provider.js', async (original) => ({ ...await original<typeof import('../src/provider.js')>(), invoke: vi.fn(), run: vi.fn() }));
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
const start = (repo: string, config = configuration(repo), epicFile = '(inline epic)') => startRun(repo, '  Fixture epic  ', epicFile, config);
// const failResult = { code: 1, stdout: '', stderr: 'controlled failure', timedOut: false };

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
