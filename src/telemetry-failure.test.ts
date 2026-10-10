import test from 'node:test';
import * as h from './telemetry-test-utils.js';
import * as path from 'node:path';
import { executeRun } from './runtime/executeRun.js';

// Test 4: Failure scenarios are recorded
test('failure scenarios are recorded in telemetry', async () => {
  await h.withRepo(async (repo) => {
    const cmd = path.join(repo, 'agent');
    h.agent(cmd, 'Implement Agent'); // Make Implement Agent fail
    const cfg = h.config(cmd);
    const r = h.record(repo);

    await h.assert.rejects(
      executeRun(repo, r, cfg, path.join(repo, 'docs/temps/run.md'))
    );

    // Check that failure is reflected in stage status
    h.assert.equal(r.stages[0].status, 'failed');

    // Check that stage failure reason is recorded
    h.assert.ok(r.stages[0].failure !== undefined);

    // Check that progress shows stage failure
    const failProgress = r.progress.find(p => p.type === 'stage' && p.subtype === 'fail' && p.stage_id === 'one');
    h.assert.ok(failProgress !== undefined);

    // Check that the attempt is recorded
    h.assert.ok(r.attempts.length > 0);
    h.assert.equal(r.attempts[0].stage_id, 'one');
    h.assert.equal(r.attempts[0].passed, false);
  });
});
