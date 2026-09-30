import assert from 'node:assert/strict';
import test from 'node:test';
import { formatFailure, formatOutcome, formatProgress } from './progress.js';
import { args } from './cli.js';

test('CLI separates positional arguments from options', () => {
  assert.deepEqual(args(['run', 'epic.md', '--repo', '/tmp/repo']), {
    positional: ['run', 'epic.md'], options: { repo: '/tmp/repo' },
  });
});

test('progress output describes run, stage, agent, and gate transitions', () => {
  const timestamp = '2026-09-29T00:00:00.000Z';
  assert.match(formatProgress({ type: 'run', subtype: 'resume', timestamp }), /run: resume/);
  assert.match(formatProgress({ type: 'stage', subtype: 'in_progress', stage_id: 'cli', timestamp }), /stage cli: in_progress/);
  assert.match(formatProgress({ type: 'agent', subtype: 'implement', stage_id: 'cli', timestamp }), /agent implement \(stage cli\)/);
  assert.match(formatProgress({ type: 'gate', subtype: 'test', stage_id: 'cli', timestamp, passed: false }), /gate test \(stage cli\): fail/);
});

test('run and resume outcomes report success and failure', () => {
  for (const action of ['run', 'resume'] as const) {
    assert.match(formatOutcome(action, { run_id: 'id', status: 'complete' }, 'record.md'), new RegExp(`${action} id: complete`));
    assert.match(formatOutcome(action, { run_id: 'id', status: 'failed' }, 'record.md'), new RegExp(`${action} id: failed`));
  }
});

test('failure formatting keeps the diagnostic visible', () => {
  assert.equal(formatFailure(new Error('provider unavailable')), 'strata: provider unavailable');
});
