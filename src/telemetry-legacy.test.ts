import test from 'node:test';
import * as h from './telemetry-test-utils.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadRun } from './runtime/loadRun.js';

// Test 6: Loading legacy records (backward compatibility)
test('legacy records without new telemetry fields remain loadable', async () => {
  await h.withRepo(async (repo) => {
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
    h.assert.equal(loaded.run_id, 'legacy-run');
    h.assert.equal(loaded.status, 'complete');
    h.assert.equal(loaded.progress.length, 6);

    // Check that we can find agent progress entries
    const agentEntries = h.findAgentProgress(loaded, 'implement');
    h.assert.equal(agentEntries.length, 2);

    // Check that duration_ms is present on the second entry but not the first
    // (simulating legacy vs new entries)
    h.assert.ok(!('duration_ms' in agentEntries[0]));
    h.assert.ok('duration_ms' in agentEntries[1]);
    h.assert.equal(agentEntries[1].duration_ms, 1000);
  });
});
