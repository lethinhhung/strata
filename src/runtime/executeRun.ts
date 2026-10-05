import { RunError, RunRecord } from './types.js';
import * as utils from './utils.js';
import { runStageWithRepairs } from './runStageWithRepairs.js';
import { archiveStageMemory } from './stageMemory.js';
import { checkpoint } from './checkpoint.js';
import { finalizeRun } from './finalizeRun.js';

export async function executeRun(repo: string, record: any, config: any, file: string) {
  // Ensure record has all required fields
  if (!('progress' in record) || !Array.isArray(record.progress)) {
    record.progress = [];
  }
  if (!record.progress.length) record.progress.push({ type: 'run', subtype: 'start', timestamp: utils.now() });
const defaultRecord: Partial<RunRecord> = {
     created_at: '',
     repository: '',
     epic: '',
     epic_path: '',
     epic_absolute_path: '',
     config: { worker:{}, strong:{}, workflow:{ max_repairs:0, review_repair_attempts:0, test_repair_attempts:0, validation_repair_attempts:0, checkpoint:false, checkpoint_prefix:'', spec_paths:[], memory_path:'', memory_policy:'', test_commands:[], quality_checks:[], setup_commands:[], require_agent_gates:true }, path:undefined },
     memory_consulted: { paths:[] },
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
  record.status = 'running';
  utils.save(record, file);
  for (const stage of record.stages) {
    if (stage.status === 'complete' && hasCheckpoint(repo, stage, config)) {
      const archivalPending = stage.archival?.status !== 'complete';
      await archiveStageMemory(repo, record, stage, config, file);
      if (archivalPending && stage.archival?.status === 'complete') checkpoint(repo, stage, config, record, file, 0);
      continue;
    }
    if (stage.status === 'complete') stage.status = 'pending';
    if (stage.dependencies.some((id: string) => record.stages.find((item: any) => item.id === id)?.status !== 'complete')) {
      record.progress.push({ type: 'run', subtype: 'fail', timestamp: utils.now() });
      throw new RunError(`Stage ${stage.id} dependencies are incomplete`);
    }
    const previousFailure = [...record.attempts].reverse().find((attempt: any) =>
      attempt.stage_id === stage.id && !attempt.passed);
    const repairContext = previousFailure?.findings
      ? utils.json(previousFailure.findings)
      : stage.failure ?? '';
    await runStageWithRepairs(repo, record, stage, config, file, repairContext);
  }
  if (config.workflow.checkpoint) {
    finalizeRun(repo, record, file);
    return;
  }
  record.status = 'complete';
  record.completed_at = utils.now();
  record.progress.push({ type: 'run', subtype: 'complete', timestamp: utils.now() });
  utils.save(record, file);
}

function hasCheckpoint(repo: string, stage: any, config: any) {
  if (!config.workflow.checkpoint) return false;
  if (typeof stage.checkpoint_commit !== 'string' || !stage.checkpoint_commit) return false;
  const result = utils.git(repo, ['merge-base', '--is-ancestor', stage.checkpoint_commit, 'HEAD'], { allowFailure: true });
  return result.status === 0;
}
