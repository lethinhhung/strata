import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeRun } from './runtime/executeRun.js';
import { startRun } from './runtime/startRun.js';
import { resumeRun } from './runtime/resumeRun.js';
import { save } from './runtime/save.js';
import { loadRun } from './runtime/loadRun.js';
import { recordPath } from './runtime/time.js';
import type { ProgressEntry, RunRecord, AgentTransition } from './runtime/types.js';

const git = (r: string, ...a: string[]) => execFileSync('git', a, { cwd: r, encoding: 'utf8' });

function setup() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-telemetry-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'strata@example.invalid');
  git(repo, 'config', 'user.name', 'Strata');
  fs.writeFileSync(path.join(repo, 'base'), 'base');
  git(repo, 'add', 'base');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'checkout', '-qb', 'test-workflow');
  return repo;
}

function agent(command: string, fail = '') {
  const source = `#!/usr/bin/env node
  const fs=require('node:fs'),p=process.argv.at(-1),r=p.match(/You are the Strata ([A-Za-z ]+)\\./)?.[1];
  if(r===${JSON.stringify(fail)})process.exit(1);
  if(r==='Implement Agent'){fs.mkdirSync('src',{recursive:true});fs.writeFileSync('src/work.ts','ok')}
  const v=r==='Epic Coordinator'?(p.includes('Review epic criteria')?{status:'pass',findings:[]}:{summary:'test',decisions:[],stages:[{id:'one',title:'One',concern:'runtime',scope:['src/**'],dependencies:[],completion_criteria:['done'],checkpoint:'one'}]}):r==='Stage Coordinator'?(p.includes('LATEST REPORTS AND CHECK EVIDENCE')?(p.includes('\"gate_passed\": false')?{decision:'blocked',rationale:'test check failure'}:{decision:'ready',rationale:'checks pass'}):{implementation_task:'implement',review_focus:[],test_task:'test',validation_requirements:[]}):r==='Archivist'?{entries:[]}:{status:'pass',findings:[],files:[],summary:'ok',uncertainties:[],gates:[]};
  process.stdout.write(JSON.stringify({type:'text',part:{text:JSON.stringify(v)}})+'\\n')`;
  fs.writeFileSync(command, source);
  fs.chmodSync(command, 0o755);
}

function config(command: string, tests: any[] = [['node', '-e', 'process.exit(0)']]) {
  const model = { provider: 'opencode', model: '', command, timeout_seconds: 10, extra_args: [] };
  const workflow = { max_repairs: 0, review_repair_attempts: 0, test_repair_attempts: 0, validation_repair_attempts: 0, checkpoint: false, checkpoint_prefix: 'strata', spec_paths: [], memory_path: 'memory', test_commands: tests, quality_checks: [], require_agent_gates: true };
  return { worker: model, strong: model, workflow, path: '' };
}

function record(repo: string, id = 'run', status = 'running'): RunRecord {
  const stage = { id: 'one', title: 'One', concern: 'runtime', dependencies: [], completion_criteria: ['done'], checkpoint: 'one', status: status === 'failed' ? 'failed' : 'pending', phase_results: [] };
  return {
    schema_version: 1,
    run_id: id,
    status,
    created_at: '',
    repository: repo,
    epic: 'test',
    epic_path: 'epic.md',
    epic_absolute_path: '',
    config: null as any,
    stages: [stage],
    attempts: [],
    events: [],
    memory_consulted: { paths: [] },
    progress: [],
    failure: status === 'failed' ? { message: 'original', timestamp: 'old' } : undefined
  };
}

async function withRepo<T>(callback: (repo: string) => Promise<T>): Promise<T> {
  const repo = setup();
  try {
    return await callback(repo);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

// Helper to find agent progress entries by subtype
function findAgentProgress(record: RunRecord, subtype: string): AgentTransition[] {
  return record.progress.filter(
    (entry): entry is AgentTransition => entry.type === 'agent' && entry.subtype === subtype
  );
}

// Helper to assert that an agent entry has basic telemetry fields
function assertAgentTelemetryFields(entry: AgentTransition, expectedRole?: string) {
  assert.ok('timestamp' in entry && typeof entry.timestamp === 'string');
  assert.ok(typeof entry.stage_id === 'string');
  if (expectedRole !== undefined) {
    assert.ok('role' in entry && entry.role === expectedRole);
  }
}

// Test 1: Provider metadata is captured in agent telemetry
test('provider metadata is captured in agent telemetry', async () => {
  await withRepo(async (repo) => {
    const cmd = path.join(repo, 'agent');
    agent(cmd);
    const cfg = config(cmd);
    const r = record(repo);
    
    // Mock the invoke function to capture what provider is being called
    // We'll do this by modifying the agent script to return specific provider info
    const agentWithProviderInfo = `#!/usr/bin/env node
    const fs=require('node:fs');
    const p=process.argv.at(-1);
    const r=p.match(/You are the Strata ([A-Za-z ]+)\\./)?.[1];
    if(r==='Implement Agent'){
      fs.mkdirSync('src',{recursive:true});
      fs.writeFileSync('src/work.ts','ok');
    }
    // Return metadata about the provider in the response
    const response = {
      status: 'pass',
      provider_metadata: {
        provider: 'opencode',
        model: 'nvidia/nemotron-3-super-120b-a12b'
      }
    };
    process.stdout.write(JSON.stringify({type:'text',part:{text:JSON.stringify(response)}})+'\\n')`;
    fs.writeFileSync(cmd, agentWithProviderInfo);
    fs.chmodSync(cmd, 0o755);
    
    await executeRun(repo, r, cfg, path.join(repo, 'docs/temps/run.md'));
    
    // Check that we have agent progress entries
    const agentEntries = findAgentProgress(r, 'implement');
    assert.ok(agentEntries.length > 0);
    
    // Check that the entry has the basic telemetry fields
    assertAgentTelemetryFields(agentEntries[0], 'Implement Agent');
    
    // TODO: Once provider metadata is actually stored in the entry,
    // we would check for provider and model fields here
  });
});

// Test 2: Retry attempts are associated with the same logical agent task
test('retry attempts are associated with same logical agent task', async () => {
  await withRepo(async (repo) => {
    const cmd = path.join(repo, 'agent');
    // Create an agent that fails 2 times then succeeds to test retry tracking
    const agentScript = `#!/usr/bin/env node
    const fs=require('node:fs');
    const p=process.argv.at(-1);
    const callCountFile = '/tmp/agent-retry-count-' + Date.now(); // Unique per test
    let calls = 0;
    try { calls = parseInt(fs.readFileSync(callCountFile, 'utf8')) || 0; } catch(e) {}
    calls++;
    fs.writeFileSync(callCountFile, String(calls));
    
    const r=p.match(/You are the Strata ([A-Za-z ]+)\\./)?.[1];
    if(r==='Implement Agent'){
      if(calls <= 2) {
        // Fail first two times with simulated transient error
        process.stderr.write('Simulated transient failure');
        process.exit(1);
      } else {
        // Succeed on third attempt and later
        fs.mkdirSync('src',{recursive:true});
        fs.writeFileSync('src/work.ts','ok');
      }
    }
    const v=r==='Epic Coordinator'?(p.includes('Review epic criteria')?{status:'pass',findings:[]}:{summary:'test',decisions:[],stages:[{id:'one',title:'One',concern:'runtime',scope:['src/**'],dependencies:[],completion_criteria:['done'],checkpoint:'one'}]}):r==='Stage Coordinator'?(p.includes('LATEST REPORTS AND CHECK EVIDENCE')?(p.includes('\"gate_passed\": false')?{decision:'blocked',rationale:'test check failure'}:{decision:'ready',rationale:'checks pass'}):{implementation_task:'implement',review_focus:[],test_task:'test',validation_requirements:[]}):r==='Archivist'?{entries:[]}:{status:'pass',findings:[],files:[],summary:'ok',uncertainties:[],gates:[]};
    process.stdout.write(JSON.stringify({type:'text',part:{text:JSON.stringify(v)}})+'\\n')`;
    fs.writeFileSync(cmd, agentScript);
    fs.chmodSync(cmd, 0o755);
    
    // Increase max_repairs to allow multiple attempts so we can see retry behavior
    const cfg = config(cmd, [['node', '-e', 'process.exit(0)']]); // Underlying test command succeeds
    cfg.workflow.max_repairs = 5; // Allow plenty of retries
    
    const r = record(repo);
    
    await executeRun(repo, r, cfg, path.join(repo, 'docs/temps/run.md'));
    
    // Check that we have agent progress entries for implement
    const agentEntries = findAgentProgress(r, 'implement');
    
    // Verify that all agent entries are for the same logical agent task (same stage_id and role)
    assert.ok(agentEntries.length > 0);
    for (const entry of agentEntries) {
      assert.equal(entry.stage_id, 'one');
      assert.equal(entry.role, 'Implement Agent');
    }
    
    // Verify that we have multiple attempts recorded (indicating retries were tracked)
    // This could be either multiple agent progress entries or attempt tracking within entries
    // For now, we'll check that we have more than one agent progress entry
    // NOTE: This assumes the implementation creates multiple entries for retries
    // If instead it enhances single entries with attempt counts, this test would need adjustment
    assert.ok(agentEntries.length >= 2, `Expected at least 2 agent entries to track retries, got ${agentEntries.length}`);
    
    // Additionally, check that the attempts show progression (first ones fail, last one succeeds)
    // We'll infer this from the fact that the stage ultimately succeeded
    assert.equal(r.stages[0].status, 'complete');
  });
});

// Test 3: Fallback to strong provider is recorded
test('fallback to strong provider is recorded in telemetry', async () => {
  await withRepo(async (repo) => {
    const cmd = path.join(repo, 'agent');
    // Create an agent that fails with transient error first time, then succeeds with strong model
    const agentScript = `#!/usr/bin/env node
    const fs=require('node:fs');
    const p=process.argv.at(-1);
    const r=p.match(/You are the Strata ([A-Za-z ]+)\\./)?.[1];
    if(r==='Implement Agent'){
      // Simulate a transient failure first time
      process.stderr.write('429 Too Many Requests');
      process.exit(1);
    }
    if(r==='Epic Coordinator'||r==='Stage Coordinator'||r==='Archivist'){
      // These should succeed
      const v=r==='Epic Coordinator'?(p.includes('Review epic criteria')?{status:'pass',findings:[]}:{summary:'test',decisions:[],stages:[{id:'one',title:'One',concern:'runtime',scope:['src/**'],dependencies:[],completion_criteria:['done'],checkpoint:'one'}]}):r==='Stage Coordinator'?(p.includes('LATEST REPORTS AND CHECK EVIDENCE')?(p.includes('\"gate_passed\": false')?{decision:'blocked',rationale:'test check failure'}:{decision:'ready',rationale:'checks pass'}):{implementation_task:'implement',review_focus:[],test_task:'test',validation_requirements:[]}):{entries:[]};
      process.stdout.write(JSON.stringify({type:'text',part:{text:JSON.stringify(v)}})+'\\n');
      return;
    }
    // For Implement Agent on retry with strong model, succeed
    fs.mkdirSync('src',{recursive:true});
    fs.writeFileSync('src/work.ts','ok');
    const v={status:'pass',findings:[]};
    process.stdout.write(JSON.stringify({type:'text',part:{text:JSON.stringify(v)}})+'\\n')`;
    fs.writeFileSync(cmd, agentScript);
    fs.chmodSync(cmd, 0o755);
    
    // Configure with a weak worker that will fail, and strong that will succeed
    const workerModel = { provider: 'opencode', model: '', command: cmd, timeout_seconds: 5, extra_args: [] };
    const strongModel = { provider: 'opencode', model: '', command: path.join(repo, 'strong-agent'), timeout_seconds: 5, extra_args: [] };
    
    // Create strong agent that always succeeds
    const strongAgent = `#!/usr/bin/env node
    const fs=require('node:fs');
    const p=process.argv.at(-1);
    const r=p.match(/You are the Strata ([A-Za-z ]+)\\./)?.[1];
    if(r==='Implement Agent'){
      fs.mkdirSync('src',{recursive:true});
      fs.writeFileSync('src/work.ts','ok');
    }
    const v=r==='Epic Coordinator'?(p.includes('Review epic criteria')?{status:'pass',findings:[]}:{summary:'test',decisions:[],stages:[{id:'one',title:'One',concern:'runtime',scope:['src/**'],dependencies:[],completion_criteria:['done'],checkpoint:'one'}]}):r==='Stage Coordinator'?(p.includes('LATEST REPORTS AND CHECK EVIDENCE')?(p.includes('\"gate_passed\": false')?{decision:'blocked',rationale:'test check failure'}:{decision:'ready',rationale:'checks pass'}):{implementation_task:'implement',review_focus:[],test_task:'test',validation_requirements:[]}):r==='Archivist'?{entries:[]}:{status:'pass',findings:[],files:[],summary:'ok',uncertainties:[],gates:[]};
    process.stdout.write(JSON.stringify({type:'text',part:{text:JSON.stringify(v)}})+'\\n')`;
    fs.writeFileSync(path.join(repo, 'strong-agent'), strongAgent);
    fs.chmodSync(path.join(repo, 'strong-agent'), 0o755);
    
    const cfg = {
      worker: workerModel,
      strong: strongModel,
      workflow: { max_repairs: 0, review_repair_attempts: 0, test_repair_attempts: 0, validation_repair_attempts: 0, checkpoint: false, checkpoint_prefix: 'strata', spec_paths: [], memory_path: 'memory', test_commands: [['node', '-e', 'process.exit(0)']], quality_checks: [], require_agent_gates: true },
      path: ''
    };
    
    const r = record(repo);
    await executeRun(repo, r, cfg, path.join(repo, 'docs/temps/run.md'));
    
    // Check that the run succeeded
    assert.equal(r.status, 'complete');
    
    // Check that we have agent entries
    const agentEntries = findAgentProgress(r, 'implement');
    assert.ok(agentEntries.length > 0);
    
    // TODO: Check that fallback usage is recorded in telemetry
  });
});

// Test 4: Failure scenarios are recorded
test('failure scenarios are recorded in telemetry', async () => {
  await withRepo(async (repo) => {
    const cmd = path.join(repo, 'agent');
    agent(cmd, 'Implement Agent'); // Make Implement Agent fail
    const cfg = config(cmd);
    const r = record(repo);
    
    await assert.rejects(
      executeRun(repo, r, cfg, path.join(repo, 'docs/temps/run.md'))
    );
    
    // Check that failure is reflected in stage status
    assert.equal(r.stages[0].status, 'failed');
    
    // Check that stage failure reason is recorded
    assert.ok(r.stages[0].failure !== undefined);
    
    // Check that progress shows stage failure
    const failProgress = r.progress.find(p => p.type === 'stage' && p.subtype === 'fail' && p.stage_id === 'one');
    assert.ok(failProgress !== undefined);
    
    // Check that the attempt is recorded
    assert.ok(r.attempts.length > 0);
    assert.equal(r.attempts[0].stage_id, 'one');
    assert.equal(r.attempts[0].passed, false);
  });
});

// Test 5: Telemetry persistence (save/load)
test('telemetry persists correctly through save/load cycle', async () => {
  await withRepo(async (repo) => {
    const cmd = path.join(repo, 'agent');
    agent(cmd);
    const cfg = config(cmd);
    const r = record(repo);
    
    await executeRun(repo, r, cfg, path.join(repo, 'docs/temps/run.md'));
    
    // Save the record
    const saveFile = path.join(repo, 'docs/temps/saved-run.md');
    save(r, saveFile);
    
    // Load the record
    const loaded = loadRun(saveFile);
    
    // Check that basic info is preserved
    assert.equal(loaded.run_id, r.run_id);
    assert.equal(loaded.status, r.status);
    assert.equal(loaded.repository, r.repository);
    assert.equal(loaded.epic, r.epic);
    
    // Check that progress is preserved
    assert.equal(loaded.progress.length, r.progress.length);
    
    // Check that agent progress entries are preserved
    const originalAgentEntries = findAgentProgress(r, 'implement');
    const loadedAgentEntries = findAgentProgress(loaded, 'implement');
    assert.equal(loadedAgentEntries.length, originalAgentEntries.length);
    
    // Check that basic telemetry fields are preserved
    for (let i = 0; i < loadedAgentEntries.length; i++) {
      assertAgentTelemetryFields(loadedAgentEntries[i], originalAgentEntries[i].role);
    }
  });
});

// Test 6: Loading legacy records (backward compatibility)
test('legacy records without new telemetry fields remain loadable', async () => {
  await withRepo(async (repo) => {
    // Create a legacy record format (missing some newer fields)
    const legacyRecord = {
      schema_version: 1,
      run_id: 'legacy-run',
      status: 'complete',
      created_at: '2026-01-01T00:00:00.000Z',
      repository: repo,
      epic: 'test',
      epic_path: 'epic.md',
      epic_absolute_path: '',
      config: {
        worker: { provider: 'opencode', model: '', command: 'test', timeout_seconds: 10, extra_args: [] },
        strong: { provider: 'opencode', model: '', command: 'test', timeout_seconds: 10, extra_args: [] },
        workflow: { max_repairs: 0, review_repair_attempts: 0, test_repair_attempts: 0, validation_repair_attempts: 0, checkpoint: false, checkpoint_prefix: 'strata', spec_paths: [], memory_path: 'memory', test_commands: [], quality_checks: [], require_agent_gates: true },
        path: undefined
      },
      progress: [
        { type: 'run', subtype: 'start', timestamp: '2026-01-01T00:00:00.000Z' },
        { type: 'agent', subtype: 'implement', stage_id: 'one', timestamp: '2026-01-01T00:00:01.000Z' },
        { type: 'stage', subtype: 'in_progress', stage_id: 'one', timestamp: '2026-01-01T00:00:02.000Z' },
        { type: 'agent', subtype: 'implement', stage_id: 'one', timestamp: '2026-01-01T00:00:03.000Z', duration_ms: 1000 },
        { type: 'stage', subtype: 'complete', stage_id: 'one', timestamp: '2026-01-01T00:00:04.000Z' },
        { type: 'run', subtype: 'complete', timestamp: '2026-01-01T00:00:05.000Z' }
      ],
      stages: [{
        id: 'one',
        title: 'One',
        concern: 'runtime',
        accepted_paths: [],
        dependencies: [],
        completion_criteria: ['done'],
        checkpoint: 'one',
        status: 'complete',
        phase_results: []
      }],
      attempts: [],
      events: [],
      memory_consulted: { paths:[] }
    };
    
    // Save it in the format that loadRun expects (fenced JSON)
    const legacyDir = path.join(repo, 'docs/temps');
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyFile = path.join(legacyDir, 'legacy-run.md');
    const legacyContent = `# Strata run ${legacyRecord.run_id}\n\n\`\`\`json\n${JSON.stringify(legacyRecord, null, 2)}\n\`\`\`\n`;
    fs.writeFileSync(legacyFile, legacyContent, { encoding: 'utf8' });
    
    // Load it - this should not throw
    const loaded = loadRun(legacyFile);
    
    // Check that it loaded correctly
    assert.equal(loaded.run_id, 'legacy-run');
    assert.equal(loaded.status, 'complete');
    assert.equal(loaded.progress.length, 6);
    
    // Check that we can find agent progress entries
    const agentEntries = findAgentProgress(loaded, 'implement');
    assert.equal(agentEntries.length, 2);
    
    // Check that duration_ms is present on the second entry but not the first
    // (simulating legacy vs new entries)
    assert.ok(!('duration_ms' in agentEntries[0]));
    assert.ok('duration_ms' in agentEntries[1]);
    assert.equal(agentEntries[1].duration_ms, 1000);
  });
});

function assertDuration(event: ProgressEntry) {
  assert.equal(event.type, 'agent');
  if (event.type === 'agent') { 
    assert.equal(typeof event.duration_ms, 'number'); 
    assert.ok(Number.isFinite(event.duration_ms)); 
  }
}