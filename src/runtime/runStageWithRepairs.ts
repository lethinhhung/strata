import * as utils from './utils.js';
import { runStage } from './runStage.js';
import { RunError, RunRecord } from './types.js';
import { checkpoint } from './checkpoint.js';

export async function runStageWithRepairs(repo: string, record: any, stage: any, config: any, file: string, initialFinding: string) {
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
  let repairContext = initialFinding;
  for (let attemptIndex = 0; attemptIndex <= config.workflow.max_repairs; attemptIndex += 1) {
    let result;
    try {
      result = await runStage(repo, record, stage, config, file, {
        repairContext,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = { passed: false, reason: message, findings: [message] };
    }
    const attempt = {
      stage_id: stage.id, number: attemptIndex + 1, passed: result.passed,
      reason: result.reason, findings: result.findings, at: utils.now(),
    };
    record.attempts.push(attempt);
    utils.save(record, file);
    if (result.passed) {
      checkpoint(repo, stage, config, record, file, attemptIndex + 1);
      record.progress.push({ type: 'stage', subtype: 'complete', stage_id: stage.id, timestamp: utils.now() });
      if (config.workflow.checkpoint) record.progress.push({ type: 'gate', subtype: 'checkpoint', stage_id: stage.id, timestamp: utils.now(), passed: true });
      utils.save(record, file);
      return;
    }
    if (attemptIndex < config.workflow.max_repairs) {
      record.events.push({ type: 'repair', stage_id: stage.id, attempt: attemptIndex + 1, details: result.findings, at: utils.now() });
      repairContext = utils.json(result.findings);
      utils.save(record, file);
    }
  }
  stage.status = 'failed';
  stage.failure = record.attempts.slice(-1)[0]?.reason;
  record.progress.push({ type: 'stage', subtype: 'fail', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  throw new RunError(`Stage ${stage.id} halted: ${stage.failure}`);
}
