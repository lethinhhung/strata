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
  let repairContext = initialFinding;
  let attemptIndex = 0;
  let previousFailure = '';
  const stagedBeforeStage = utils.git(repo, ['diff', '--cached', '--name-only']).stdout
    .split('\n').map((filePath: string) => filePath.trim()).filter(Boolean);
  while (true) {
    attemptIndex += 1;
    let result: any;
    try {
      result = await runStage(repo, record, stage, config, file, {
        repairContext,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = { passed: false, blocked: true, reason: message, findings: [message] };
    }
    const attempt = {
      stage_id: stage.id, number: attemptIndex, passed: result.passed,
      reason: result.reason, findings: result.findings, at: utils.now(),
    };
    record.attempts.push(attempt);
    utils.save(record, file);
    if (result.passed) {
      checkpoint(repo, stage, config, record, file, attemptIndex, stagedBeforeStage);
      record.progress.push({ type: 'stage', subtype: 'complete', stage_id: stage.id, timestamp: utils.now() });
      if (config.workflow.checkpoint) record.progress.push({ type: 'gate', subtype: 'checkpoint', stage_id: stage.id, timestamp: utils.now(), passed: true });
      utils.save(record, file);
      return;
    }
    if (result.blocked) break;
    // max_repairs counts retries after the initial stage pass.
    if (attemptIndex > (config.workflow.max_repairs ?? 2)) break;
    const signature = utils.json({ reason: result.reason, findings: result.findings });
    record.events.push({ type: 'repair', stage_id: stage.id, attempt: attemptIndex, details: result.findings, at: utils.now() });
    repairContext = utils.json({
      previous_attempt: result.findings,
      repeated_failure: signature === previousFailure,
      instruction: signature === previousFailure
        ? 'The same failure repeated. Diagnose why the previous approach made no progress and choose a different repair or report a concrete blocker.'
        : 'Continue repairing the stage based on the latest evidence.',
    });
    previousFailure = signature;
    utils.save(record, file);
  }
  stage.status = 'failed';
  stage.failure = record.attempts.slice(-1)[0]?.reason;
  record.progress.push({ type: 'stage', subtype: 'fail', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  throw new RunError(`Stage ${stage.id} halted: ${stage.failure}`);
}
