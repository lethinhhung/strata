import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runChecks } from './runtime/checks.js';

test('checks retain configured result order and record durations when run concurrently', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'strata-checks-'));
  try {
    const first = path.join(directory, 'first');
    const second = path.join(directory, 'second');
    const rendezvous = `const fs=require('node:fs'); const [self,other]=process.argv.slice(1); fs.writeFileSync(self,'ready'); const deadline=Date.now()+5000; while(!fs.existsSync(other)&&Date.now()<deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10); if(!fs.existsSync(other)) process.exit(2); console.log(self);`;
    const results = await runChecks(directory, [
      { id: 'first', kind: 'test', command: [process.execPath, '-e', rendezvous, first, second], allow_unavailable: false, unavailable_reason: '' },
      { id: 'second', kind: 'quality', command: [process.execPath, '-e', rendezvous, second, first], allow_unavailable: false, unavailable_reason: '' },
    ], '', 2);

    assert.deepEqual(results.map(result => result.id), ['first', 'second']);
    assert.ok(results.every(result => result.gate_passed));
    assert.ok(results.every(result => Number.isFinite(result.duration_ms) && result.duration_ms >= 0));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
