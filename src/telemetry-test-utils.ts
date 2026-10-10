import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeRun } from './runtime/executeRun.js';
import { save } from './runtime/save.js';
import { loadRun } from './runtime/loadRun.js';
import type { RunRecord, AgentTransition } from './runtime/types.js';

export { assert, fs, path, executeRun, save, loadRun };

export const git = (r: string, ...a: string[]) => execFileSync('git', a, { cwd: r, encoding: 'utf8' });

export function setup() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-telemetry-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'strata@example.invalid');
  git(repo, 'config', 'user.name', 'Strata');
  fs.writeFileSync(path.join(repo, 'base'), 'base');
  git(repo, 'add', 'base');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'checkout', '-qb', 'test-workflow');
  return repo;
}

export function agent(command: string, fail = '') {
  const source = `#!/usr/bin/env node
  const fs=require('node:fs'),p=process.argv.at(-1),r=p.match(/You are the Strata ([A-Za-z ]+)\\./)?.[1];
  if(r===${JSON.stringify(fail)})process.exit(1);
  if(r==='Implement Agent'){fs.mkdirSync('src',{recursive:true});fs.writeFileSync('src/work.ts','ok')}
  const v=r==='Epic Coordinator'?(p.includes('Review epic criteria')?{status:'pass',findings:[]}:{summary:'test',decisions:[],stages:[{id:'one',title:'One',concern:'runtime',scope:['src/**'],dependencies:[],completion_criteria:['done'],checkpoint:'one'}]}):r==='Stage Coordinator'?(p.includes('LATEST REPORTS AND CHECK EVIDENCE')?(p.includes('\"gate_passed\": false')?{decision:'blocked',rationale:'test check failure'}:{decision:'ready',rationale:'checks pass'}):{implementation_task:'implement',review_focus:[],test_task:'test',validation_requirements:[]}):r==='Archivist'?{entries:[]}:{status:'pass',findings:[],files:[],summary:'ok',uncertainties:[],gates:[]};
  process.stdout.write(JSON.stringify({type:'text',part:{text:JSON.stringify(v)}})+'\\n')`;
  fs.writeFileSync(command, source);
  fs.chmodSync(command, 0o755);
}

export function config(command: string, tests: any[] = [['node', '-e', 'process.exit(0)']]) {
  const model = { provider: 'opencode', model: '', command, timeout_seconds: 10, extra_args: [] };
  const workflow = { max_repairs: 0, review_repair_attempts: 0, test_repair_attempts: 0, validation_repair_attempts: 0, checkpoint: false, checkpoint_prefix: 'strata', spec_paths: [], memory_path: 'memory', test_commands: tests, quality_checks: [], require_agent_gates: true };
  return { worker: model, strong: model, workflow, path: '' };
}

export function record(repo: string, id = 'run', status = 'running'): RunRecord {
  const stage = { id: 'one', title: 'One', concern: 'runtime', dependencies: [], completion_criteria: ['done'], checkpoint: 'one', status: status === 'failed' ? 'failed' : 'pending', phase_results: [] };
  return {
    schema_version: 1,
    run_id: id,
    status,
    created_at: '',
    repository: repo,
    epic: 'test',
    epic_path: 'epic.md',
    epic_absolute_path: '',
    config: null as any,
    stages: [stage],
    attempts: [],
    events: [],
    memory_consulted: { paths: [] },
    progress: [],
    failure: status === 'failed' ? { message: 'original', timestamp: 'old' } : undefined
  };
}

export async function withRepo<T>(callback: (repo: string) => Promise<T>): Promise<T> {
  const repo = setup();
  try {
    return await callback(repo);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

// Helper to find agent progress entries by subtype
export function findAgentProgress(record: RunRecord, subtype: string): AgentTransition[] {
  return record.progress.filter(
    (entry): entry is AgentTransition => entry.type === 'agent' && entry.subtype === subtype
  );
}

// Helper to assert that an agent entry has basic telemetry fields
export function assertAgentTelemetryFields(entry: AgentTransition, expectedRole?: string) {
  assert.ok('timestamp' in entry && typeof entry.timestamp === 'string');
  assert.ok(typeof entry.stage_id === 'string');
  if (expectedRole !== undefined) {
    assert.ok('role' in entry && entry.role === expectedRole);
  }
}
