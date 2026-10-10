import assert from 'node:assert/strict';
import test from 'node:test';
import { createProgressReporter } from './progress.js';
import type { ProgressEntry } from './runtime/types.js';

function capture(entries: ProgressEntry[]): string {
    const write = process.stdout.write;
    let output = '';
    process.stdout.write = ((chunk: string | Uint8Array) => {
        output += chunk.toString();
        return true;
    }) as typeof process.stdout.write;
    try {
        const reporter = createProgressReporter(true);
        entries.forEach((entry) => reporter.print(entry));
        return output.replace(/\r\x1b\[2K/g, '');
    } finally {
        process.stdout.write = write;
    }
}

const timestamp = (seconds: number) => `2026-09-29T00:00:${String(seconds).padStart(2, '0')}.000Z`;

test('live progress groups retries under same agent and shows attempt count', () => {
    const time = timestamp;
    const line = capture([
        { type: 'run', subtype: 'start', timestamp: time(0) },
        { type: 'stage', subtype: 'in_progress', stage_id: 'test', timestamp: time(0) },
        { type: 'agent', subtype: 'implement', stage_id: 'test', role: 'implementer', timestamp: time(1) },
        { type: 'agent', subtype: 'implement', stage_id: 'test', role: 'implementer', timestamp: time(2) },
        { type: 'agent', subtype: 'review', stage_id: 'test', role: 'reviewer', timestamp: time(3) }
    ]);
    assert.match(line, /agent reviewer \(att 1\) \[retries 0\]/);
    assert.match(line, /\| retries: 1/);
});

test('live progress shows stage and agent unknown when no data', () => {
    const line = capture([
        { type: 'run', subtype: 'start', timestamp: timestamp(0) },
        { type: 'run', subtype: 'resume', timestamp: timestamp(1) }
    ]);
    assert.match(line, /stage unknown: agent unknown/);
});
