import assert from 'node:assert/strict';
import test from 'node:test';
import { args } from './cli.js';

test('CLI separates positional arguments and supported options', () => {
  assert.deepEqual(args(['run', 'epic.md', '--repo', '/tmp/repo']), {
    positional: ['run', 'epic.md'], options: { repo: '/tmp/repo' },
  });
  assert.throws(() => args(['--unknown']), /Unknown option/);
  assert.throws(() => args(['--config']), /requires a value/);
});
