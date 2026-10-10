import assert from 'node:assert/strict';
import test from 'node:test';
import { invoke, ProviderError } from './providers.js';
import { parseCodexOutput, parseOpenCodeOutput } from './providers/parse.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('provider rejects unsupported adapters with a useful error', async () => {
  await assert.rejects(invoke({
    provider: 'unknown', model: '', command: 'unused', timeout_seconds: 1, extra_args: [],
  }, 'prompt', '.', 'Test Agent'), (error: Error) => {
    assert.ok(error instanceof ProviderError);
    assert.match(error.message, /Unsupported CLI provider/);
    return true;
  });
});

test('provider retries rate-limited worker calls with the same prompt', async () => {
   const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-provider-'));
   const command = path.join(repo, 'opencode');
   const count = path.join(repo, 'calls');
   const script = `#!/usr/bin/env node\nconst fs=require('node:fs');\nconst file=${JSON.stringify(count)};\nconst calls=Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1;\nfs.writeFileSync(file,String(calls));\nif(calls<3){process.stderr.write('429 Too Many Requests');process.exit(1);}\nprocess.stdout.write(JSON.stringify({part:{text:'{"status":"pass"}'}})+'\\n');`;
   try {
     fs.writeFileSync(command, script);
     fs.chmodSync(command, 0o755);
     const response = await invoke({ provider: 'opencode', model: '', command, timeout_seconds: 5, extra_args: [] }, 'prompt', repo, 'Test Agent');
     assert.equal(response.text, '{"status":"pass"}');
     assert.equal(fs.readFileSync(count, 'utf8'), '3');
   } finally { fs.rmSync(repo, { recursive: true, force: true }); }
 });

test('provider retries a tool-only response instead of parsing its event log', async () => {
   const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-provider-empty-'));
   const command = path.join(repo, 'opencode');
   const count = path.join(repo, 'calls');
   const script = `#!/usr/bin/env node\nconst fs=require('node:fs');\nconst file=${JSON.stringify(count)};\nconst calls=Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1;\nfs.writeFileSync(file,String(calls));\nconst event=calls===1?{type:'tool_use',part:{type:'tool'}}:{part:{text:'{"status":"pass"}'}};\nprocess.stdout.write(JSON.stringify(event)+'\\n');`;
   try {
     fs.writeFileSync(command, script);
     fs.chmodSync(command, 0o755);
     const response = await invoke({ provider: 'opencode', model: '', command, timeout_seconds: 5, extra_args: [] }, 'prompt', repo, 'Implement Agent');
     assert.equal(response.text, '{"status":"pass"}');
     assert.equal(fs.readFileSync(count, 'utf8'), '2');
   } finally { fs.rmSync(repo, { recursive: true, force: true }); }
 });
 
test('provider stops OpenCode after repeated transient logs', async () => {
   const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-provider-log-'));
   const command = path.join(repo, 'opencode');
   const count = path.join(repo, 'calls');
   const script = `#!/usr/bin/env node\nconst fs=require('node:fs');\nconst file=${JSON.stringify(count)};\nconst calls=Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1;\nfs.writeFileSync(file,String(calls));\nif(calls<4){process.stderr.write('no agent text response\\n'.repeat(3));setInterval(()=>{},1000);}\nelse process.stdout.write(JSON.stringify({part:{text:'{"status":"pass"}'}})+'\\n');`;
   try {
     fs.writeFileSync(command, script);
     fs.chmodSync(command, 0o755);
     const response = await invoke({ provider: 'opencode', model: '', command, timeout_seconds: 5, extra_args: [] }, 'prompt', repo, 'Test Agent');
     assert.equal(response.text, '{"status":"pass"}');
     assert.equal(fs.readFileSync(count, 'utf8'), '4');
   } finally { fs.rmSync(repo, { recursive: true, force: true }); }
 });

 test('parseCodexOutput extracts telemetry fields correctly', () => {
   const stdout = `{"type":"response.completed","response":{"output_text":"Hello","usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8},"model":"test-model"}}\n`;
   const result = parseCodexOutput(stdout);
   assert.equal(result.text, 'Hello');
   assert.equal(result.model, 'test-model');
   assert.equal(result.prompt_tokens, 5);
   assert.equal(result.completion_tokens, 3);
   assert.equal(result.total_tokens, 8);
 });

 test('parseOpenCodeOutput extracts telemetry fields correctly', () => {
   const stdout = `{"part":{"text":"Hello"},"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8},"model":"test-model"}\n`;
   const result = parseOpenCodeOutput(stdout);
   assert.equal(result.text, 'Hello');
   assert.equal(result.model, 'test-model');
   assert.equal(result.prompt_tokens, 5);
   assert.equal(result.completion_tokens, 3);
   assert.equal(result.total_tokens, 8);
 });
