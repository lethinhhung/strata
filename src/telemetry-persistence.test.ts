import test from 'node:test';
import * as h from './telemetry-test-utils.js';
import * as path from 'node:path';
import { executeRun } from './runtime/executeRun.js';
import { save } from './runtime/save.js';
import { loadRun } from './runtime/loadRun.js';

// Test 5: Telemetry persistence (save/load)
test('telemetry persists correctly through save/load cycle', async () => {
  await h.withRepo(async (repo) => {
    const cmd = path.join(repo, 'agent');
    h.agent(cmd);
    const cfg = h.config(cmd);
    const r = h.record(repo);

    await executeRun(repo, r, cfg, path.join(repo, 'docs/temps/run.md'));

    // Save the record
    const saveFile = path.join(repo, 'docs/temps/saved-run.md');
    save(r, saveFile);

    // Load the record
    const loaded = loadRun(saveFile);

    // Check that basic info is preserved
    h.assert.equal(loaded.run_id, r.run_id);
    h.assert.equal(loaded.status, r.status);
    h.assert.equal(loaded.repository, r.repository);
    h.assert.equal(loaded.epic, r.epic);

    // Check that progress is preserved
    h.assert.equal(loaded.progress.length, r.progress.length);

    // Check that agent progress entries are preserved
    const originalAgentEntries = h.findAgentProgress(r, 'implement');
    const loadedAgentEntries = h.findAgentProgress(loaded, 'implement');
    h.assert.equal(loadedAgentEntries.length, originalAgentEntries.length);

    // Check that basic telemetry fields are preserved
    for (let i = 0; i < loadedAgentEntries.length; i++) {
      h.assertAgentTelemetryFields(loadedAgentEntries[i], originalAgentEntries[i].role);
    }
  });
});
