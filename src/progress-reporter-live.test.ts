import assert from 'node:assert/strict';
import test from 'node:test';
import { createProgressReporter } from './progress.js';

function captureLive(run: (print: (entry: any) => void) => void): string {
    const write = process.stdout.write;
    let output = '';
    process.stdout.write = ((chunk: string | Uint8Array) => {
        output += chunk.toString();
        return true;
    }) as typeof process.stdout.write;
    try {
        const reporter = createProgressReporter(true);
        run((entry) => reporter.print(entry));
        return output.replace(/\r\x1b\[2K/g, '');
    } finally {
        process.stdout.write = write;
    }
}

const at = (ms: number) => new Date(ms).toISOString();
const start = Date.parse('2026-09-29T00:00:00.000Z');

test('live view compactly presents current stage, agent status, identity, and telemetry', () => {
    const output = captureLive((print) => {
        print({ type: 'run', subtype: 'start', timestamp: at(start) });
        print({ type: 'stage', subtype: 'in_progress', stage_id: 'build', timestamp: at(start) });
        print({ type: 'agent', subtype: 'implement', stage_id: 'build', role: 'implementer',
            timestamp: at(start), duration_ms: 1500, total_tokens: 42, model: 'test-model' });
    });
    const line = output.split('\n').at(-1) ?? '';
    assert.match(line, /stage build \(in_progress\): agent implementer/);
    assert.match(line, /att 1/);
    assert.match(line, /1\.5s.*42tok.*test-model/);
    assert.match(line, /retries: 0.*tokens: 42.*elapsed:/);
    assert.equal(line.includes('\n'), false);
});

test('live view groups repeated attempts for the same stage and agent', () => {
    const output = captureLive((print) => {
        print({ type: 'run', subtype: 'start', timestamp: at(start) });
        print({ type: 'stage', subtype: 'in_progress', stage_id: 'test', timestamp: at(start) });
        for (const offset of [0, 1000]) print({ type: 'agent', subtype: 'test', stage_id: 'test',
            role: 'tester', timestamp: at(start + offset) });
    });
    const line = output.split('\n').at(-1) ?? '';
    assert.match(line, /agent tester \(att 2\) \[retries 1\]/);
    assert.match(line, /\| retries: 1/);
});

test('live view handles records without optional telemetry or an active stage', () => {
    const output = captureLive((print) => {
        print({ type: 'run', subtype: 'start', timestamp: at(start) });
        print({ type: 'agent', subtype: 'validate', stage_id: 'old', role: 'validator', timestamp: at(start) });
    });
    const line = output.split('\n').at(-1) ?? '';
    assert.match(line, /stage unknown: agent validator/);
    assert.match(line, /att 1/);
    assert.equal(line.includes(' — '), false);
    assert.match(line, /tokens: 0/);
});
