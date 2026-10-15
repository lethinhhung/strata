import { test, expect } from 'vitest';
import { createTempRepo, writeFixtureProvider, cleanupRepo } from './helpers/provider-recovery-fixture.js';
import { run } from '../src/provider.js';
import path from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * Verify that the provider correctly recovers from a stopped child after a command
 * is invoked.  The legacy test exercised the same logic in JavaScript and
 * asserted that the child did not time‑out but its output was preserved.
 */

test('invoke recover: child exited early', async () => {
  const repo = createTempRepo();
  try {
    const provider = writeFixtureProvider(repo, 'fixture-provider.js', `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'trace.jsonl'), JSON.stringify({ args }) + '\\n');
console.log(JSON.stringify({ type: 'text', text: 'completed' }));
`);
    // The provider script echoes its arguments; it will exit immediately.
    const result = await run(process.execPath, [provider, 'run', '--sandbox', 'read-only'], repo, 2000, process.env, {
      idleTimeoutMs: 500,
    });
    expect(result.timedOut).toBe(false);
    // The provider writes a trace file; ensure it contains our arguments.
    const trace = path.join(repo, 'trace.jsonl');
    const data = readFileSync(trace, 'utf8');
    expect(data).toContain('read-only');
  } finally {
    cleanupRepo(repo);
  }
});
