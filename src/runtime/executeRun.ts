import { RunError, RunRecord } from './types.js';
import * as utils from './utils.js';
import { runStageWithRepairs } from './runStageWithRepairs.js';
import { finalValidation } from './finalValidation.js';
import { archiveMemory } from './archiveMemory.js';

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
     config: { worker:{}, strong:{}, workflow:{ max_repairs:0, checkpoint:false, checkpoint_prefix:'', spec_paths:[], memory_path:'', test_commands:[], quality_checks:[], }, path:undefined },
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
  record.status = 'running';
  utils.save(record, file);
  for (const stage of record.stages) {
    if (stage.status === 'complete' && hasCheckpoint(repo, stage, config)) continue;
    if (stage.status === 'complete') stage.status = 'pending';
    if (stage.dependencies.some((id: string) => record.stages.find((item: any) => item.id === id)?.status !== 'complete')) {
      record.progress.push({ type: 'run', subtype: 'fail', timestamp: utils.now() });
      throw new RunError(`Stage ${stage.id} dependencies are incomplete`);
    }
    await runStageWithRepairs(repo, record, stage, config, file, stage.failure ?? '');
  }
  let final = await finalValidation(repo, record, config, file);
  let repairs = 0;
  while (!final.passed && repairs < config.workflow.max_repairs) {
    const target = record.stages.find((stage: any) => stage.id === final.review.target_stage_id) ?? record.stages.slice(-1)[0];
    repairs += 1;
    record.events.push({ type: 'final_repair', stage_id: target.id, findings: final.review.findings, at: utils.now() });
    target.status = 'pending';
    utils.save(record, file);
    await runStageWithRepairs(repo, record, target, config, file, utils.json({ final_review: final.review, evidence: final.evidence }));
    final = await finalValidation(repo, record, config, file);
  }
  if (!final.passed) {
    record.progress.push({ type: 'run', subtype: 'fail', timestamp: utils.now() });
    throw new RunError('Final integration review or validation failed; run record is preserved for resumption');
  }
  if (config.workflow.checkpoint) {
    const tag = `${config.workflow.checkpoint_prefix}-epic-${record.run_id}`;
    const result = utils.git(repo, ['tag', '-a', tag, '-m', `Completed Strata epic ${record.run_id}`], { allowFailure: true });
    if (result.status !== 0) throw new RunError(`Epic checkpoint failed: ${result.stderr.trim()}`);
    record.epic_checkpoint = tag;
    // Record epic checkpoint gate transition
    record.progress.push({ type: 'gate', subtype: 'checkpoint', stage_id: 'epic', timestamp: utils.now(), passed: true });
  }
  record.status = 'complete';
  record.completed_at = utils.now();
  record.progress.push({ type: 'run', subtype: 'complete', timestamp: utils.now() });
  utils.save(record, file);
  try {
    record.archival = await archiveMemory(repo, record, config);
  } catch (error) {
    record.archival = { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
  utils.save(record, file);
}

function hasCheckpoint(repo: string, stage: any, config: any) {
  if (!config.workflow.checkpoint) return false;
  if (typeof stage.checkpoint_commit !== 'string' || !stage.checkpoint_commit) return false;
  const result = utils.git(repo, ['cat-file', '-e', `${stage.checkpoint_commit}^{commit}`], { allowFailure: true });
  return result.status === 0;
}
