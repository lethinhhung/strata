import test from 'node:test';
import * as h from './telemetry-test-utils.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { executeRun } from './runtime/executeRun.js';

// Test 2: Retry attempts are associated with the same logical agent task
test('retry attempts are associated with same logical agent task', async () => {
  await h.withRepo(async (repo) => {
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
    const cfg = h.config(cmd, [['node', '-e', 'process.exit(0)']]); // Underlying test command succeeds
    cfg.workflow.max_repairs = 5; // Allow plenty of retries

    const r = h.record(repo);

    await executeRun(repo, r, cfg, path.join(repo, 'docs/temps/run.md'));

    // Check that we have agent progress entries for implement
    const agentEntries = h.findAgentProgress(r, 'implement');

    // Verify that all agent entries are for the same logical agent task (same stage_id and role)
    h.assert.ok(agentEntries.length > 0);
    for (const entry of agentEntries) {
      h.assert.equal(entry.stage_id, 'one');
      h.assert.equal(entry.role, 'Implement Agent');
    }

    // Verify that we have multiple attempts recorded (indicating retries were tracked)
    // This could be either multiple agent progress entries or attempt tracking within entries
    // For now, we'll check that we have more than one agent progress entry
    // NOTE: This assumes the implementation creates multiple entries for retries
    // If instead it enhances single entries with attempt counts, this test would need adjustment
    h.assert.ok(agentEntries.length >= 2, `Expected at least 2 agent entries to track retries, got ${agentEntries.length}`);

    // Additionally, check that the attempts show progression (first ones fail, last one succeeds)
    // We'll infer this from the fact that the stage ultimately succeeded
    h.assert.equal(r.stages[0].status, 'complete');
  });
});
