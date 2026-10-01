import assert from 'node:assert/strict';
import test from 'node:test';
import { formatFailure, formatOutcome, formatProgress } from './progress.js';
import { args } from './cli.js';

test('CLI separates positional arguments from options', () => {
  assert.deepEqual(args(['run', 'epic.md', '--repo', '/tmp/repo']), {
    positional: ['run', 'epic.md'], options: { repo: '/tmp/repo' },
  });
});

test('CLI accepts an inline epic prompt', () => {
  assert.deepEqual(args(['run', '--prompt', 'Add a settings screen', '--repo', '/tmp/repo']), {
    positional: ['run'], options: { prompt: 'Add a settings screen', repo: '/tmp/repo' },
  });
});

test('progress output describes run, stage, agent, and gate transitions', () => {
  const timestamp = '2026-09-29T00:00:00.000Z';
  assert.match(formatProgress({ type: 'run', subtype: 'resume', timestamp }), /run: resume/);
  assert.match(formatProgress({ type: 'stage', subtype: 'in_progress', stage_id: 'cli', timestamp }), /stage cli: in_progress/);
  assert.match(formatProgress({ type: 'agent', subtype: 'implement', stage_id: 'cli', timestamp }), /agent implement \(stage cli\)/);
  assert.match(formatProgress({ type: 'gate', subtype: 'test', stage_id: 'cli', timestamp, passed: false }), /gate test \(stage cli\): fail/);
});

test('progress output includes duration_ms for agent steps', () => {
  const timestamp = '2026-09-29T00:00:00.000Z';
  const entry = { type: 'agent', subtype: 'implement', stage_id: 'cli', timestamp, duration_ms: 1500 } as const;
  assert.match(formatProgress(entry), /agent implement \(stage cli\) — 1.5s/);
});

test('progress output does not include duration_ms when not present', () => {
  const timestamp = '2026-09-29T00:00:00.000Z';
  const entry = { type: 'agent', subtype: 'implement', stage_id: 'cli', timestamp } as const;
  assert.match(formatProgress(entry), /agent implement \(stage cli\)/);
  assert.equal(formatProgress(entry).includes(' — '), false);
});

test('run and resume live progress format completed agent durations', () => {
  const timestamp = '2026-09-29T00:00:00.000Z';
  for (const action of ['run', 'resume'] as const) {
    const line = formatProgress({ type: 'agent', subtype: 'implement', stage_id: action, timestamp, duration_ms: 42 });
    assert.match(line, /agent implement/);
    assert.match(line, /0\.0s/);
  }
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
