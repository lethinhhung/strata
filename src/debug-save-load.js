import { save } from './runtime/save.js';
import { loadRun } from './runtime/loadRun.js';

// Create an object similar to what's in the legacy record
const oldRecord = {
  schema_version: 1,
  run_id: 'legacy-run',
  status: 'completed',
  created_at: '2026-01-01T00:00:00.000Z',
  repository: '/tmp/test',
  epic: 'test',
  epic_path: 'epic.md',
  epic_absolute_path: '',
  config: { worker: {provider:'opencode',model:'',command:'',timeout_seconds:10,extra_args:[]}, strong: {provider:'opencode',model:'',command:'',timeout_seconds:10,extra_args:[]}, workflow: { max_repairs: 0, review_repair_attempts: 0, test_repair_attempts: 0, validation_repair_attempts: 0, checkpoint: false, checkpoint_prefix: '', spec_paths: [], memory_path: 'memory', memory_policy: '', test_commands: [], quality_checks: [], setup_commands: [], require_agent_gates: true, check_concurrency: 1 }, path: '' },
  memory_consulted: { paths: [] },
  stages: [{ id: 'one', title: 'One', concern: 'test', dependencies: [], completion_criteria: ['done'], checkpoint: 'one', status: 'complete', phase_results: [] }],
  attempts: [],
  events: [],
  progress: [
    { type: 'run', subtype: 'start', timestamp: '2026-01-01T00:00:00.000Z' },
    { type: 'agent', subtype: 'explore', stage_id: 'one', timestamp: '2026-01-01T00:00:01.000Z' },
    // Intentionally omit model, prompt_tokens, etc. to simulate old record
    { type: 'agent', subtype: 'implement', stage_id: 'one', timestamp: '2026-01-01T00:00:02.000Z', duration_ms: 10 },
    { type: 'stage', subtype: 'complete', stage_id: 'one', timestamp: '2026-01-01T00:00:03.000Z' },
    { type: 'run', subtype: 'complete', timestamp: '2026-01-01T00:00:04.000Z' }
  ],
  failure: undefined
};

console.log('Original implement step:');
const originalImplementStep = oldRecord.progress.find(x => x.type === 'agent' && x.subtype === 'implement');
console.log(JSON.stringify(originalImplementStep, null, 2));
console.log('Original completion_tokens:', originalImplementStep.completion_tokens);
console.log('Original duration_ms:', originalImplementStep.duration_ms);

// Save it to a file
const tmpFile = '/tmp/legacy-test.md';
save(oldRecord, tmpFile);

// Load it back
const loaded = loadRun(tmpFile);

console.log('Loaded implement step:');
const loadedImplementStep = loaded.progress.find(x => x.type === 'agent' && x.subtype === 'implement');
console.log(JSON.stringify(loadedImplementStep, null, 2));
console.log('Loaded completion_tokens:', loadedImplementStep.completion_tokens);
console.log('Loaded duration_ms:', loadedImplementStep.duration_ms);
console.log('Type of loaded duration_ms:', typeof loadedImplementStep.duration_ms);