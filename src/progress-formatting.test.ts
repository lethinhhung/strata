import assert from 'node:assert/strict';
import test from 'node:test';
import { formatProgress } from './progress.js';

test('progress output describes run, stage, agent, and gate transitions', () => {
    const timestamp = '2026-09-29T00:00:00.000Z';
    assert.ok(formatProgress({ type: 'run', subtype: 'resume', timestamp }).includes('run: resume'));
    assert.ok(formatProgress({ type: 'stage', subtype: 'in_progress', stage_id: 'cli', timestamp }).includes('stage cli: in_progress'));
    assert.ok(formatProgress({ type: 'agent', subtype: 'implement', stage_id: 'cli', timestamp }).includes('agent implement (stage cli)'));
    assert.ok(formatProgress({ type: 'gate', subtype: 'test', stage_id: 'cli', timestamp, passed: false }).includes('gate test (stage cli): fail'));
});

test('progress output includes duration_ms for agent steps', () => {
    const timestamp = '2026-09-29T00:00:00.000Z';
    const entry = { type: 'agent', subtype: 'implement', stage_id: 'cli', timestamp, duration_ms: 1500 } as const;
    assert.ok(formatProgress(entry).includes('agent implement (stage cli) — 1.5s'));
});

test('progress output does not include duration_ms when not present', () => {
    const timestamp = '2026-09-29T00:00:00.000Z';
    const entry = { type: 'agent', subtype: 'implement', stage_id: 'cli', timestamp } as const;
    assert.ok(formatProgress(entry).includes('agent implement (stage cli)'));
    assert.equal(formatProgress(entry).includes(' — '), false);
});