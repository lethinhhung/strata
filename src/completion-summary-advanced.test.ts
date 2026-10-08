import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCompletionSummary } from './progress.js';

test('completion summary omits validation when not present', () => {
    const record: any = {
        run_id: 'test-run',
        status: 'complete',
        stages: [],
        events: [],
        attempts: [],
        failure: undefined,
        failure_history: undefined,
        epic_checkpoint: undefined,
        completed_at: undefined,
        archival: undefined,
        progress: [
            { type: 'run', subtype: 'start', timestamp: new Date(Date.now() - 1).toISOString() },
            { type: 'run', subtype: 'complete', timestamp: new Date().toISOString() }
        ],
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
    const summary = formatCompletionSummary('run', record);
    assert.ok(summary.includes('elapsed 00:00')); // less than a second
    assert.ok(summary.includes('stages comp 0/0'));
    assert.ok(summary.includes('agts 0'));
    assert.ok(summary.includes('ret 0'));
    assert.ok(summary.includes('tok 0'));
    // No validation string
    assert.equal(summary.includes(' — validation:'), false);
});

test('completion summary handles older records (missing start/run event)', () => {
    const record: any = {
        run_id: 'test-run',
        status: 'complete',
        stages: [],
        progress: [
            { type: 'run', subtype: 'complete', timestamp: new Date().toISOString() }
            // No start/resume event
        ]
    };
    const summary = formatCompletionSummary('run', record);
    // Elapsed time should be 0 because stRun is undefined
    assert.ok(summary.includes('elapsed 00:00'));
});

test('completion summary groups retries per agent key', () => {
    const now = Date.now();
    const record: any = {
        run_id: 'test-run',
        status: 'complete',
        stages: [],
        progress: [
            { type: 'run', subtype: 'start', timestamp: new Date(now - 1000).toISOString() },
            { type: 'run', subtype: 'complete', timestamp: new Date().toISOString() },
            // Agent A: two attempts
            { type: 'agent', subtype: 'test', stage_id: 'stage1', role: 'roleA', timestamp: new Date(now - 900).toISOString() },
            { type: 'agent', subtype: 'test', stage_id: 'stage1', role: 'roleA', timestamp: new Date(now - 800).toISOString() },
            // Agent B: one attempt
            { type: 'agent', subtype: 'test', stage_id: 'stage2', role: 'roleB', timestamp: new Date(now - 700).toISOString() }
        ]
    };
    const summary = formatCompletionSummary('run', record);
    // Retries: for stage1:roleA:test -> 2 attempts -> 1 retry; stage2:roleB:test -> 1 attempt -> 0 retries. Total = 1.
    assert.ok(summary.includes('ret 1'));
});

test('completion summary presents failed final validation and zero changed paths', () => {
    const record: any = {
        run_id: 'validation-run', status: 'failed', stages: [], progress: [],
        final_validation: { result: { status: 'failed' }, observed_changed_paths: [] }
    };
    const summary = formatCompletionSummary('resume', record);
    assert.ok(summary.includes('resume validation-run: failed'));
    assert.ok(summary.includes(' — validation: failed (0 ch)'));
});

test('completion summary counts agent entries regardless of optional fields', () => {
    const now = Date.parse('2026-09-29T00:00:02.000Z');
    const record: any = {
        run_id: 'test-run',
        status: 'complete',
        stages: [{ id: 'stage1', subtype: 'complete' }],
        progress: [
            { type: 'run', subtype: 'start', timestamp: new Date(now - 2000).toISOString() },
            { type: 'run', subtype: 'complete', timestamp: new Date(now).toISOString() },
            { type: 'stage', subtype: 'in_progress', stage_id: 'stage1', timestamp: new Date(now - 2000).toISOString() },
            { type: 'stage', subtype: 'complete', stage_id: 'stage1', timestamp: new Date(now - 1000).toISOString() },
            // Agent entry without duration_ms, total_tokens, model
            { type: 'agent', subtype: 'implement', stage_id: 'stage1', role: 'implementer', timestamp: new Date(now - 1500).toISOString() },
            // Another agent entry without optional fields
            { type: 'agent', subtype: 'validate', stage_id: 'stage1', role: 'validator', timestamp: new Date(now - 1200).toISOString() }
        ]
    };
    const summary = formatCompletionSummary('run', record);
    assert.ok(summary.includes('elapsed 00:02'));
    assert.ok(summary.includes('stages comp 1/1'));
    assert.ok(summary.includes('agts 2'));
    assert.ok(summary.includes('ret 0'));
    assert.ok(summary.includes('tok 0'));
    // No validation
    assert.equal(summary.includes(' — validation:'), false);
});
