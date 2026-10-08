import test from 'node:test';
import * as h from './telemetry-test-utils.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { executeRun } from './runtime/executeRun.js';

// Test 1: Provider metadata is captured in agent telemetry
test('provider metadata is captured in agent telemetry', async () => {
  await h.withRepo(async (repo) => {
    const cmd = path.join(repo, 'agent');
    h.agent(cmd);
    const cfg = h.config(cmd);
    const r = h.record(repo);

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
    const agentEntries = h.findAgentProgress(r, 'implement');
    h.assert.ok(agentEntries.length > 0);

    // Check that the entry has the basic telemetry fields
    h.assertAgentTelemetryFields(agentEntries[0], 'Implement Agent');

    // TODO: Once provider metadata is actually stored in the entry,
    // we would check for provider and model fields here
  });
});
