import * as utils from './utils.js';
import { RunError, RunRecord } from './types.js';
import { inScope } from './helpers.js';

export function checkpoint(repo: string, stage: any, config: any, record: any, file: string, attempt: number, stagedAtAttemptStart: string[] = []) {
  // Ensure record has all required fields
  if (!('progress' in record) || !Array.isArray(record.progress)) {
    record.progress = [];
  }
const defaultRecord: Partial<RunRecord> = {
     created_at: '',
     repository: '',
     epic: '',
     epic_path: '',
     epic_absolute_path: '',
     config: { worker:{}, strong:{}, workflow:{ max_repairs:0, review_repair_attempts:0, test_repair_attempts:0, validation_repair_attempts:0, checkpoint:false, checkpoint_prefix:'', spec_paths:[], memory_path:'', memory_policy:'', test_commands:[], quality_checks:[], setup_commands:[], require_agent_gates:true }, path:undefined },
     memory_consulted: { paths:[], excerpt:'' },
     plan: undefined,
     updated_at: undefined,
     final_review: undefined,
     final_validation: undefined,
     final_evidence: undefined,
     final_validated_at: undefined,
     epic_checkpoint: undefined,
     completed_at: undefined,
     failure: undefined,
   };
(Object.keys(defaultRecord) as (keyof RunRecord)[]).forEach(key => {
     if (!(key in record)) {
       (record as any)[key] = defaultRecord[key];
     }
   });
  // Now record is guaranteed to have all fields of RunRecord
  const changed = utils.changes(new Map(), utils.runSnapshot(repo, record, file));
  // A resumed run may share a worktree with changes left by earlier stages or
  // made after the run began. Commit only this stage's planned or agent-reported
  // paths and leave unrelated files untouched.
  const eligible = changed.filter((filePath: string) =>
    !filePath.startsWith('specs/') && !filePath.startsWith('docs/temps/') &&
    (inScope(filePath, stage.scope ?? []) || (stage.accepted_paths ?? []).includes(filePath) ||
      (stage.test_repair_paths ?? []).includes(filePath)));
  if (config.workflow.checkpoint) {
    if (!eligible.length && !stage.checkpoint_commit) throw new RunError(`No files to checkpoint for stage ${stage.id}`);
    if (eligible.length) {
      const staged = utils.git(repo, ['diff', '--cached', '--name-only', '--', ...eligible]).stdout
        .split('\n').map((filePath: string) => filePath.trim()).filter(Boolean)
        .filter((filePath: string) => stagedAtAttemptStart.includes(filePath));
      if (staged.length) throw new RunError(`Checkpoint for ${stage.id} refuses paths already staged before this attempt: ${staged.join(', ')}`);
      const add = utils.git(repo, ['add', '-A', '--', ...eligible], { allowFailure: true });
      if (add.status !== 0) throw new RunError(add.stderr.trim());
      const ordinal = Math.max(1, record.stages.findIndex((item: any) => item.id === stage.id) + 1);
      const message = `stage-${ordinal}: ${stage.title}${attempt > 1 ? ` (fix ${attempt})` : ''}`;
      const commit = utils.git(repo, ['commit', '--only', '-m', message, '--', ...eligible], { allowFailure: true });
      if (commit.status !== 0) throw new RunError(`Checkpoint failed for ${stage.id}: ${commit.stderr.trim()}`);
      stage.checkpoint_commit = utils.git(repo, ['rev-parse', 'HEAD']).stdout.trim();
      stage.checkpoint_subject = message;
    }
    const branch = utils.git(repo, ['branch', '--show-current']).stdout.trim();
    const pushed = pushCheckpoint(repo, branch);
    const ordinal = Math.max(1, record.stages.findIndex((item: any) => item.id === stage.id) + 1);
    const stageCommit = utils.git(repo, ['log', '--format=%H', `--grep=^stage-${ordinal}:`, '-1'], { allowFailure: true });
    if (stageCommit.status === 0 && stageCommit.stdout.trim()) stage.checkpoint_commit = stageCommit.stdout.trim();
    stage.pushed = pushed.passed;
    stage.push_evidence = pushed.message;
    record.progress.push({ type: 'gate', subtype: 'push', stage_id: stage.id, timestamp: utils.now(), passed: pushed.passed });
  }
  stage.status = 'complete';
  delete stage.failure;
  stage.completed_at = utils.now();
  utils.save(record, file);
}

function pushCheckpoint(repo: string, branch: string) {
  let last = '';
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const push = utils.git(repo, ['push', 'origin', branch], { allowFailure: true });
    if (push.status === 0) return { passed: true, message: `Pushed ${branch} on attempt ${attempt}` };
    last = (push.stderr || push.stdout).trim();
    if (attempt === 5) break;
    const rebase = utils.git(repo, ['pull', '--rebase', 'origin', branch], { allowFailure: true });
    if (rebase.status !== 0) {
      last = `${last}\nPull --rebase failed: ${(rebase.stderr || rebase.stdout).trim()}`;
      break;
    }
    // The source workflow waits between retries to avoid hammering the remote.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
  }
  return { passed: false, message: last || 'Push failed' };
}
