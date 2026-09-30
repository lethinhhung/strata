import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resumeRun } from './runtime/resumeRun.js';
import { loadRun } from './runtime/loadRun.js';

test('resume persists failed status and reason when workflow execution throws', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-resume-failed-'));
  const file = path.join(repo, 'run.md');
  const record = {
    schema_version: 1, run_id: 'failed-resume', status: 'running', stages: [{
      id: 'one', status: 'failed', dependencies: ['missing'],
    }],
  };
  try {
    fs.writeFileSync(file, JSON.stringify(record));
    await assert.rejects(resumeRun(repo, file, { workflow: {} }), /Stage one dependencies are incomplete/);
    const saved = loadRun(file);
    assert.equal(saved.status, 'failed');
    assert.match(saved.failure?.message ?? '', /dependencies are incomplete/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
