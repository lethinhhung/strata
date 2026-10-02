import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkpoint } from './runtime/checkpoint.js';

const git = (repo: string, ...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
function repository() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-checkpoint-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'strata@example.invalid');
  git(repo, 'config', 'user.name', 'Strata Test');
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  git(repo, 'add', 'base.txt'); git(repo, 'commit', '-qm', 'base');
  return repo;
}
const stage = (accepted_paths: string[] = ['src/owned.ts']) => ({ id: 'one', title: 'One', checkpoint: 'cp-one', status: 'in_progress', accepted_paths });
const config = { workflow: { checkpoint: true, checkpoint_prefix: 'strata' } };
const run = (current: ReturnType<typeof stage>) => ({ stages: [current], progress: [] as any[] });

test('checkpoint commits stage changes while preserving unrelated worktree changes', () => {
  const repo = repository();
  try {
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src/owned.ts'), 'stage work\n');
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'unrelated\n');
    const current = stage();
    checkpoint(repo, current, config, run(current), path.join(repo, 'run.json'), 1);
    assert.equal(current.status, 'complete');
    assert.equal(git(repo, 'show', '--format=', '--name-only', 'HEAD').trim(), 'src/owned.ts');
    assert.equal(fs.readFileSync(path.join(repo, 'outside.txt'), 'utf8'), 'unrelated\n');
    assert.match(git(repo, 'status', '--short'), /\?\? outside\.txt/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('checkpoint refuses pre-staged stage paths without consuming the index', () => {
  const repo = repository();
  try {
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src/owned.ts'), 'stage work\n');
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'unrelated\n');
    git(repo, 'add', 'src/owned.ts', 'outside.txt');
    const current = stage();
    assert.throws(() => checkpoint(repo, current, config, run(current), path.join(repo, 'run.json'), 1, ['src/owned.ts', 'outside.txt']), /refuses paths already staged before this attempt/);
    assert.equal(git(repo, 'diff', '--cached', '--name-only').trim(), 'outside.txt\nsrc/owned.ts');
    assert.equal(git(repo, 'log', '-1', '--pretty=%s').trim(), 'base');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
