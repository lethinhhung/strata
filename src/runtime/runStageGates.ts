import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';
import { runChecks, setupChecks, workflowChecks } from './checks.js';

export async function runStageGates(repo: string, record: any, stage: any, config: any, file: string,
  specContext: string, coordination: any, repairContext: string, implementation: any,
  implementationAttempt: any, implementChanges: string[], sourceChanges: string[]) {
  const beforeReview = utils.runSnapshot(repo, record, file);
  record.progress.push({ type: 'agent', subtype: 'review', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  let review: any;
  try { review = await utils.askReadOnly(config, 'Review Agent', {
    repo,
    text: `Review the production diff against the stage contract, specs, and repo rules. Do not edit files. The supplied diff and recorded phase paths are the authoritative changes for this stage; unrelated files in the worktree were not necessarily changed by this run and must not be reported as stage scope violations.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nREVIEW FOCUS:\n${utils.json(coordination.review_focus ?? [])}\nSTAGE PATH AUDIT:\n${utils.json(stagePathAudit(stage))}\nDIFF:\n${helpers.reviewDiff(repo, sourceChanges, stage.checkpoint_commit)}`,
  }, specContext, {}); } catch (error) {
    record.progress.push({ type: 'gate', subtype: 'review', stage_id: stage.id, timestamp: utils.now(), passed: false });
    utils.save(record, file);
    throw error;
  }
  const reviewMutations = utils.changes(beforeReview, utils.runSnapshot(repo, record, file));
  helpers.addPhase(stage, 'review', review, { observed_changed_paths: reviewMutations });
  utils.save(record, file);
  if (reviewMutations.length) throw new RunError(`Review Agent modified files: ${reviewMutations.join(', ')}`);
  const reviewPassed = review.status === 'pass' && !(review.findings ?? []).some((item: any) => ['critical', 'major'].includes(String(item.severity).toLowerCase()));
  record.progress.push({ type: 'gate', subtype: 'review', stage_id: stage.id, timestamp: utils.now(), passed: reviewPassed });
  const setupEvidence = runChecks(repo, setupChecks(config.workflow), 'setup');
  const beforeTest = utils.runSnapshot(repo, record, file);
  record.progress.push({ type: 'agent', subtype: 'test', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  const tested = await utils.askScoped(config, 'Test Agent', {
    repo, text: `Create deterministic tests; edit test files only. Strata ran the configured setup commands before this phase and runs configured checks after it. Review setup evidence first; if setup failed, report the exact blocker and do not claim test results. On repair attempts, use carried findings to fix test expectations or coverage only when they conflict with the contract; do not weaken tests to hide production defects.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nTASK:\n${coordination.test_task}\nSETUP EVIDENCE:\n${utils.json(setupEvidence)}\nREVIEW:\n${utils.json(review.findings ?? [])}\nCARRIED REPAIR FINDINGS:\n${repairContext}`,
  }, specContext, { allowedPath: (target: string) => helpers.isTestPath(target) && helpers.inScope(target, stage.scope) });
  const tester = tested.result;
  const testChanges = utils.changes(beforeTest, utils.runSnapshot(repo, record, file));
  const testViolations = testChanges.filter((target: string) => !helpers.isTestPath(target));
  helpers.addPhase(stage, 'test', tester, { observed_changed_paths: testChanges, attempted_changed_paths: tested.attempted, discarded_changed_paths: tested.discarded, scope_violations: testViolations });
  const checks = workflowChecks(config.workflow);
  const evidence = [...setupEvidence, ...runChecks(repo, checks)];
  helpers.addPhase(stage, 'engine_checks', evidence);
  const requiredTests = checks.filter((item: any) => item.kind === 'test' && !item.allow_unavailable);
  const checksPassed = !testViolations.length && requiredTests.length > 0 && evidence.every((item: any) => item.gate_passed);
  const testPassed = checksPassed && (!config.workflow.require_agent_gates || tester.status === 'pass');
  record.progress.push({ type: 'gate', subtype: 'test', stage_id: stage.id, timestamp: utils.now(), passed: testPassed });
  return validateStage(repo, record, stage, config, file, specContext, coordination, review, tester, evidence, reviewPassed, testPassed);
}

async function validateStage(repo: string, record: any, stage: any, config: any, file: string, context: string,
  coordination: any, review: any, tester: any, evidence: any[], reviewPassed: boolean, testPassed: boolean) {
  const before = utils.runSnapshot(repo, record, file);
  record.progress.push({ type: 'agent', subtype: 'validate', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  let validation: any;
  try { validation = await utils.askReadOnly(config, 'Validate Agent', {
    repo, text: `Validate the contract, test evidence, checks, rules, and scope. Do not edit. Strata collected engine check evidence and applied each repository check's configured unavailable policy; treat gate_passed as authoritative for command checks. A missing required test check fails. A command that runs and exits nonzero fails, even if its unavailable policy allows missing executables. The recorded stage path audit is authoritative for changes made or attempted by this stage. Ignore unrelated dirty files and do not change files.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nREQUIREMENTS:\n${utils.json(coordination.validation_requirements ?? [])}\nSTAGE PATH AUDIT:\n${utils.json(stagePathAudit(stage))}\nREVIEW:\n${utils.json(review)}\nTESTER:\n${utils.json(tester)}\nEVIDENCE:\n${utils.json(evidence)}`,
  }, context, {}); } catch (error) {
    record.progress.push({ type: 'gate', subtype: 'validation', stage_id: stage.id, timestamp: utils.now(), passed: false });
    utils.save(record, file);
    throw error;
  }
  const mutations = utils.changes(before, utils.runSnapshot(repo, record, file));
  helpers.addPhase(stage, 'validate', validation, { observed_changed_paths: mutations });
  utils.save(record, file);
  if (mutations.length) throw new RunError(`Validate Agent modified files: ${mutations.join(', ')}`);
  const validationPassed = validation.status === 'pass';
  record.progress.push({ type: 'gate', subtype: 'validation', stage_id: stage.id, timestamp: utils.now(), passed: validationPassed });
  const passed = testPassed && (!config.workflow.require_agent_gates || (reviewPassed && validationPassed));
  return { passed, reason: passed ? '' : 'A required stage gate failed or required test evidence is unavailable', findings: { implementation: [], review: review.findings ?? [], test: tester.findings ?? [], validation: validation.findings ?? [], evidence } };
}

function stagePathAudit(stage: any) {
  return (stage.phase_results ?? []).map((phase: any) => ({
    phase: phase.phase,
    observed_changed_paths: phase.observed_changed_paths ?? [],
    attempted_changed_paths: phase.attempted_changed_paths ?? [],
    discarded_changed_paths: phase.discarded_changed_paths ?? [],
    scope_violations: phase.scope_violations ?? [],
  }));
}
