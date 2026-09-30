import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ask, askScoped } from './runtime/ask.js';

test('ask retries malformed agent output and accepts structured JSON', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-ask-'));
  const command = path.join(repo, 'opencode');
  const count = path.join(repo, 'calls');
  fs.mkdirSync(path.join(repo, 'src/runtime'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src/runtime/types.ts'), 'export type RunRecord = {};');
  const script = `#!/usr/bin/env node\nconst fs=require('node:fs');\nconst file=${JSON.stringify(count)};\nconst calls=Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1;\nfs.writeFileSync(file,String(calls));\nconst prompt=process.argv.at(-1);\nconst text=calls===1?'prose response':JSON.stringify({status:'pass',summary:prompt.includes('Verified existing source paths: src/runtime/types.ts')?'ok':'missing'});\nprocess.stdout.write(JSON.stringify({part:{text}})+'\\n');`;
  try {
    fs.writeFileSync(command, script);
    fs.chmodSync(command, 0o755);
    const model = { provider: 'opencode', model: '', command, timeout_seconds: 5, extra_args: [] };
    const result = await ask({ worker: model, strong: model }, 'Implement Agent', { repo, text: 'Edit `src/runtime/types.ts`.' }, 'context');
    assert.equal(result.summary, 'ok');
    assert.equal(fs.readFileSync(count, 'utf8'), '2');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('scoped agents retain allowed edits when their provider returns no final text', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-scoped-'));
  const command = path.join(repo, 'opencode');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(command, `#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync('src/runtime.test.ts','retained');`);
  fs.chmodSync(command, 0o755);
  try {
    const model = { provider: 'opencode', model: '', command, timeout_seconds: 5, extra_args: [] };
    const out = await askScoped({ worker: model, strong: model }, 'Test Agent', { repo, text: 'Add a test.' }, '', { allowedPath: (file) => file === 'src/runtime.test.ts' });
    assert.equal(out.result.status, 'fail');
    assert.deepEqual(out.applied, ['src/runtime.test.ts']);
    assert.equal(fs.readFileSync(path.join(repo, 'src/runtime.test.ts'), 'utf8'), 'retained');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
