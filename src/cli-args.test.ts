import assert from 'node:assert/strict';
import test from 'node:test';
import { args } from './cliArgs.js';

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