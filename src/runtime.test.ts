import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkpoint } from './runtime/checkpoint.js';
import { runSnapshot } from './runtime/git.js';
import { changes } from './runtime/changes.js';
import { inScope } from './runtime/helpers.js';
import { validatePlan } from './runtime/validate.js';

const plan = () => validatePlan({ stages: [
  { id: 'one', title: 'One', concern: 'a', scope: ['src/a.ts'], dependencies: [], completion_criteria: ['done'], checkpoint: 'cp-one' },
  { id: 'two', title: 'Two', concern: 'b', scope: ['src/b.ts'], dependencies: ['one'], completion_criteria: ['done'], checkpoint: 'cp-two' },
] });

test('plans retain dependency and checkpoint identities and reject forward dependencies', () => {
  const stages = plan();
  assert.deepEqual(stages.map((stage: any) => [stage.id, stage.dependencies, stage.checkpoint, stage.status]), [
    ['one', [], 'cp-one', 'pending'], ['two', ['one'], 'cp-two', 'pending'],
  ]);
  assert.throws(() => validatePlan({ stages: [{ ...stages[0], id: 'bad', dependencies: ['later'] }] }), /earlier stages/);
});

test('change detection includes additions, edits, and removals while scopes stay bounded', () => {
  assert.deepEqual(changes(new Map([['src/a.ts', 'old'], ['src/remove.ts', 'x']]), new Map([['src/a.ts', 'new'], ['test/a.ts', 'x']])), ['src/a.ts', 'src/remove.ts', 'test/a.ts']);
  assert.equal(inScope('src/runtime/part.ts', ['src/runtime/**']), true);
  assert.equal(inScope('src/runtime-old/part.ts', ['src/runtime/**']), false);
});

const git = (repo: string, ...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
function repository() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-checkpoint-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'strata@example.invalid');
  git(repo, 'config', 'user.name', 'Strata Test');
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  git(repo, 'add', 'base.txt');
  git(repo, 'commit', '-qm', 'base');
  return repo;
}
const stage = () => ({ id: 'one', title: 'One', checkpoint: 'cp-one', checkpoint_commit: undefined as string | undefined, status: 'in_progress', scope: ['src/**'] });
const config = { workflow: { checkpoint: true, checkpoint_prefix: 'strata' } };

test('checkpoint commits scoped work and refuses an empty first checkpoint', () => {
  const repo = repository();
  try {
    const file = path.join(repo, 'run.json');
    const record = { status: 'running' };
    const current = stage();
    fs.writeFileSync(file, JSON.stringify(record));
    assert.deepEqual([...runSnapshot(repo, record, file)], []);
    assert.throws(() => checkpoint(repo, current, config, record, file, 1), /No files to checkpoint/);
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src/work.ts'), 'work\n');
    checkpoint(repo, current, config, record, file, 1);
    assert.equal(current.status, 'complete');
    assert.equal(current.checkpoint_commit, git(repo, 'rev-parse', 'HEAD').trim());
    assert.match(git(repo, 'log', '-1', '--pretty=%s'), /strata: one One \[cp-one\]/);
    assert.match(fs.readFileSync(file, 'utf8'), /"status": "running"/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('checkpoint rejects out-of-scope changes without committing or disturbing the index', () => {
  const repo = repository();
  try {
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'unrelated\n');
    assert.throws(() => checkpoint(repo, stage(), config, {}, path.join(repo, 'run.json'), 1), /outside stage scope: outside.txt/);
    assert.equal(git(repo, 'log', '-1', '--pretty=%s').trim(), 'base');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('checkpoint rejects pre-staged in-scope and unrelated paths without consuming them', () => {
  const repo = repository();
  try {
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src/owned.ts'), 'stage work\n');
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'other work\n');
    git(repo, 'add', 'src/owned.ts', 'outside.txt');
    assert.throws(() => checkpoint(repo, stage(), config, {}, path.join(repo, 'run.json'), 1), /outside stage scope/);
    assert.equal(git(repo, 'diff', '--cached', '--name-only').trim(), 'outside.txt\nsrc/owned.ts');
    assert.equal(git(repo, 'log', '-1', '--pretty=%s').trim(), 'base');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('checkpoint excludes specification and temporary run documents from stage scope', () => {
  const repo = repository();
  try {
    fs.mkdirSync(path.join(repo, 'specs'));
    fs.writeFileSync(path.join(repo, 'specs/note.md'), 'spec\n');
    const current = stage();
    checkpoint(repo, current, { workflow: { checkpoint: false, checkpoint_prefix: 'strata' } }, {}, path.join(repo, 'run.json'), 1);
    assert.equal(current.status, 'complete');
    assert.equal(git(repo, 'log', '-1', '--pretty=%s').trim(), 'base');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
