import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCompletionSummary, formatFailure } from './progress.js';
import type { RunRecord } from './runtime/types.js';

test('run and resume completion summary reports success and failure', () => {
    // We create a minimal record that matches RunRecord
    const record: RunRecord = {
        schema_version: 1,
        run_id: 'id',
        status: 'complete',
        stages: [],
        events: [],
        attempts: [],
        failure: undefined,
        failure_history: undefined,
        epic_checkpoint: undefined,
        completed_at: undefined,
        archival: undefined,
        progress: [],
        created_at: new Date().toISOString(),
        repository: '',
        epic: '',
        epic_path: '',
        epic_absolute_path: '',
        config: { worker: {}, strong: {}, workflow: { max_repairs: 0, review_repair_attempts: 0, test_repair_attempts: 0, validation_repair_attempts: 0, checkpoint: false, checkpoint_prefix: '', spec_paths: [], memory_path: '', memory_policy: '', test_commands: [], quality_checks: [], setup_commands: [], require_agent_gates: true, check_concurrency: 1 }, path: undefined },
        memory_consulted: { paths: [] },
        plan: undefined,
        updated_at: undefined,
        pull_request: undefined,
        final_review: undefined,
        final_validation: undefined,
        final_evidence: undefined,
        final_validated_at: undefined
    };
    for (const action of ['run', 'resume'] as const) {
        const line = formatCompletionSummary(action, record);
        // We expect the line to contain the action, run_id, status, and elapsed time 0:00
        assert.ok(line.includes(`${action} id: complete`));
        assert.ok(line.includes('elapsed 00:00'));
    }
});

test('failure formatting keeps the diagnostic visible', () => {
    assert.equal(formatFailure(new Error('provider unavailable')), 'strata: provider unavailable');
});

test('completion summary includes all fields: elapsed time, stages, agents, retries, tokens, validation', () => {
    const now = Date.parse('2026-09-29T01:00:00.000Z');
    const startTime = new Date(now - 3600000).toISOString();
    const endTime = new Date(now).toISOString();
    const record: any = {
        run_id: 'test-run',
        status: 'complete',
        stages: [
            { id: 'stage1', subtype: 'complete' },
            { id: 'stage2', subtype: 'complete' },
            { id: 'stage3', subtype: 'in_progress' } // not complete
        ],
        progress: [
            { type: 'run', subtype: 'start', timestamp: startTime },
            { type: 'run', subtype: 'complete', timestamp: endTime },
            { type: 'stage', subtype: 'in_progress', stage_id: 'stage1', timestamp: startTime },
            { type: 'stage', subtype: 'complete', stage_id: 'stage1', timestamp: new Date(now - 300000).toISOString() },
            { type: 'stage', subtype: 'in_progress', stage_id: 'stage2', timestamp: new Date(now - 200000).toISOString() },
            { type: 'stage', subtype: 'complete', stage_id: 'stage2', timestamp: new Date(now - 100000).toISOString() },
            { type: 'agent', subtype: 'implement', stage_id: 'stage1', role: 'implementer', timestamp: new Date(now - 250000).toISOString(), duration_ms: 1000, total_tokens: 10 },
            { type: 'agent', subtype: 'implement', stage_id: 'stage1', role: 'implementer', timestamp: new Date(now - 240000).toISOString(), duration_ms: 1000, total_tokens: 10 },
            { type: 'agent', subtype: 'implement', stage_id: 'stage2', role: 'implementer', timestamp: new Date(now - 150000).toISOString(), duration_ms: 2000, total_tokens: 20 },
            { type: 'agent', subtype: 'validate', stage_id: 'stage2', role: 'validator', timestamp: new Date(now - 50000).toISOString(), duration_ms: 500, total_tokens: 5 }
        ],
        final_validation: {
            result: { status: 'passed' },
            observed_changed_paths: ['path1', 'path2'] // 2 changes
        }
    };
    const summary = formatCompletionSummary('run', record);
    assert.equal(summary,
        'run test-run: complete — elapsed 1:00:00 — stages comp 2/3 — agts 4 — ret 1 — tok 45 — validation: passed (2 ch)');
});
