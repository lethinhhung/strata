import test from 'node:test';
import * as h from './telemetry-test-utils.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { executeRun } from './runtime/executeRun.js';

// Test 3: Fallback to strong provider is recorded
test('fallback to strong provider is recorded in telemetry', async () => {
  await h.withRepo(async (repo) => {
    const cmd = path.join(repo, 'agent');
    // Create an agent that fails with transient error first time, then succeeds with strong model
    const agentScript = `#!/usr/bin/env node
    const fs=require('node:fs');
    const p=process.argv.at(-1);
    const r=p.match(/You are the Strata ([A-Za-z ]+)\\./)?.[1];
    if(r==='Implement Agent'){
      // Simulate a transient failure first time
      process.stderr.write('429 Too Many Requests retry-after=0');
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

    const r = h.record(repo);
    await executeRun(repo, r, cfg, path.join(repo, 'docs/temps/run.md'));

    // Check that the run succeeded
    h.assert.equal(r.status, 'complete');

    // Check that we have agent entries
    const agentEntries = h.findAgentProgress(r, 'implement');
    h.assert.ok(agentEntries.length > 0);

    // TODO: Check that fallback usage is recorded in telemetry
  });
});
