import fs from 'node:fs';

// Create a legacy record like in the test
const oldRecord = {
  schema_version: 1,
  run_id: 'legacy-run',
  status: 'completed',
  created_at: '2026-01-01T00:00:00.000Z',
  repository: '/tmp/test',
  epic: 'test',
  epic_path: 'epic.md',
  epic_absolute_path: '',
  config: { worker: {}, strong: {}, workflow: { max_repairs: 0, review_repair_attempts: 0, test_repair_attempts: 0, validation_repair_attempts: 0, checkpoint: false, checkpoint_prefix: '', spec_paths: [], memory_path: 'memory', memory_policy: '', test_commands: [], quality_checks: [], setup_commands: [], require_agent_gates: true, check_concurrency: 1 }, path: '' },
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

// Save it to a file
const tmpFile = '/tmp/legacy-test.md';
const body = `# Strata run ${oldRecord.run_id}\n\n\`\`\`json\n${JSON.stringify(oldRecord, null, 2)}\n\`\`\`\n`;
fs.writeFileSync(tmpFile, body, { encoding: 'utf8' });

// Load it back
const contents = fs.readFileSync(tmpFile, 'utf8');
const fenced = contents.match(/```json\s*([\s\S]*?)```/i);
const record = JSON.parse(fenced?.[1] ?? contents);

console.log('Loaded record:');
console.log(JSON.stringify(record, null, 2));

const implementStep = record.progress.find((x) => x.type === 'agent' && x.subtype === 'implement');
console.log('\nImplement step:');
console.log(JSON.stringify(implementStep, null, 2));

console.log('\nduration_ms:', implementStep.duration_ms);
console.log('typeof duration_ms:', typeof implementStep.duration_ms);