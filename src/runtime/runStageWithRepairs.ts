import * as utils from './utils.js';
import * as helpers from './helpers.js';
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
        repairRole: repairIsTestOnly(repairContext) ? 'Test Agent' : 'Implement Agent',
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

export function repairIsTestOnly(context: unknown) {
  let findings: any = context;
  if (typeof context === 'string') {
    try { findings = JSON.parse(context); } catch { findings = context; }
  }
  if (findings && typeof findings === 'object' && !Array.isArray(findings)) {
    const implementationIssues = (findings.implementation ?? []).filter(isSubstantiveSourceFinding);
    const sourceIssues = [...implementationIssues, ...(findings.source ?? [])];
    if (sourceIssues.length) return false;
    const testGateFailed = (findings.evidence ?? []).some((item: any) => item.kind === 'test' && !item.passed);
    const testAgentReportedFailure = (findings.test ?? []).some(isTestFinding);
    if (testGateFailed || testAgentReportedFailure) return true;
    const productionReviews = (findings.review ?? []).filter((item: any) => !isTestFinding(item));
    if (productionReviews.length) return false;
    const reviewIssues = findings.final_review?.findings ?? findings.final_review ?? [];
    const validationIssues = findings.validation?.findings ?? findings.validation ?? [];
    const testIssues = [...(findings.test ?? []), ...(Array.isArray(reviewIssues) ? reviewIssues : []), ...(Array.isArray(validationIssues) ? validationIssues : [])];
    const failedTestEvidence = (findings.evidence ?? []).some((item: any) => ['test', 'final_test'].includes(item.kind) && !item.passed);
    const hasValidationFailure = Boolean(findings.validation && (Array.isArray(findings.validation) ? findings.validation.length : findings.validation.status === 'fail' || validationIssues.length));
    const issuesAreTestOnly = testIssues.length > 0 && testIssues.every(isTestFinding);
    return (issuesAreTestOnly || failedTestEvidence) && (!hasValidationFailure || validationIssues.length > 0 && validationIssues.every(isTestFinding));
  }
  return /missing test coverage|test assertion|test expectation|tests? (?:are )?failing/i.test(String(findings));
}

function isTestFinding(item: any) {
  const file = item && typeof item === 'object' ? item.path ?? item.file ?? '' : '';
  const detail = `${file} ${item?.message ?? item?.description ?? item ?? ''}`;
  return helpers.isTestPath(file) || /missing test coverage|test assertion|test expectation|tests? (?:are )?failing|(?:failed|failing|failure).{0,80}(?:tests?|suites?|jest)|(?:tests?|suites?|jest).{0,80}(?:failed|failing|failure)|jest.{0,80}(?:error|fail|missing)/i.test(detail);
}

function isSubstantiveSourceFinding(item: any) {
  if (!item || typeof item !== 'object') return false;
  const severity = String(item.severity ?? '').toLowerCase();
  if (!['critical', 'major', 'high', 'error', 'blocking'].includes(severity)) return false;
  const paths = [item.path, item.file, ...(Array.isArray(item.affected_paths) ? item.affected_paths : [])]
    .filter((file): file is string => typeof file === 'string' && file.length > 0);
  return paths.some((file) => !helpers.isTestPath(file));
}
