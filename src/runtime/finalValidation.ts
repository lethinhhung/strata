import * as utils from './utils.js';
import { runChecks } from './checks.js';
import { RunRecord } from './types.js';

export async function finalValidation(repo: string, record: any, config: any, file: string) {
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
  const context = utils.phaseContext(repo, config);
  record.progress.push({ type: 'agent', subtype: 'epic_coordinator', stage_id: 'epic', timestamp: utils.now() });
  utils.save(record, file);
  const review = await utils.askReadOnly(config, 'Epic Coordinator', {
    repo,
    shape: '{"status":"pass|fail","findings":[],"target_stage_id":"optional stage id"}',
    text: `Review epic criteria, cross-stage consistency, regressions, and architecture. Check the latest completed result for each stage. Earlier failed attempts are resolved when followed by a passing attempt and checkpoint; do not treat historical attempts as current failures. The read-only workspace intentionally has no Git metadata, so do not fail because Git diff/status is unavailable. Use recorded observed changed paths, completed phase results, checkpoint identity, and engine check evidence to assess the work. Return a target_stage_id only for a substantive unresolved issue in completed work.\nEPIC:\n${record.epic}\nSTAGE RESULTS:\n${utils.json(record.stages)}`,
  }, context, { strong: true });
  const evidence = [...runChecks(repo, config.workflow.test_commands, 'final_test'), ...runChecks(repo, config.workflow.quality_checks, 'final_quality')];
  const beforeValidator = utils.runSnapshot(repo, record, file);
  record.progress.push({ type: 'agent', subtype: 'validate', stage_id: 'epic', timestamp: utils.now() });
  utils.save(record, file);
  const validator = await utils.askReadOnly(config, 'Validate Agent', {
    repo,
    shape: '{"status":"pass|fail","findings":[],"gates":[{"name":"...","passed":true,"evidence":"..."}]}',
    text: `Read-only final validation of epic criteria, stage results, review findings, test evidence, configured quality checks, repository rules, and plan integrity. Missing or skipped required checks fail. Do not edit files.\nEPIC:\n${record.epic}\nSTAGES:\n${utils.json(record.stages)}\nEPIC REVIEW:\n${utils.json(review)}\nENGINE EVIDENCE:\n${utils.json(evidence)}`,
  }, context, {});
  const validatorMutations = utils.changes(beforeValidator, utils.runSnapshot(repo, record, file));
  record.final_review = review;
  record.final_validation = { result: validator, observed_changed_paths: validatorMutations };
  record.final_evidence = evidence;
  record.final_validated_at = utils.now();
  const passed = review.status === 'pass' && !(review.findings ?? []).length &&
    validator.status === 'pass' && !validatorMutations.length &&
    config.workflow.test_commands.length > 0 && evidence.some((item: any) => item.kind === 'final_test') && evidence.every((item: any) => item.passed);
  record.progress.push({ type: 'gate', subtype: 'validation', stage_id: 'epic', timestamp: utils.now(), passed });
  utils.save(record, file);
  return { passed, review, evidence };
}
