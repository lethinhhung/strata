import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';
import { runChecks } from './checks.js';

export async function runStageGates(repo: string, record: any, stage: any, config: any, file: string,
  specContext: string, coordination: any, repairIsTestOnly: boolean, implementation: any,
  implementationAttempt: any, implementChanges: string[], sourceChanges: string[]) {
  const beforeReview = utils.runSnapshot(repo, record, file);
  record.progress.push({ type: 'agent', subtype: 'review', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  let review: any;
  try { review = await utils.askReadOnly(config, 'Review Agent', {
    repo,
    text: `Review the production diff against the stage contract, specs, and repo rules. Do not edit files.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nREVIEW FOCUS:\n${utils.json(coordination.review_focus ?? [])}\nDIFF:\n${helpers.reviewDiff(repo, sourceChanges, stage.checkpoint_commit)}`,
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
  const beforeTest = utils.runSnapshot(repo, record, file);
  record.progress.push({ type: 'agent', subtype: 'test', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  const tested = repairIsTestOnly ? { result: implementation, attempted: implementationAttempt.attempted, discarded: implementationAttempt.discarded } : await utils.askScoped(config, 'Test Agent', {
    repo, text: `Create deterministic tests; edit test files only. Strata runs configured checks in the repository.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nTASK:\n${coordination.test_task}\nREVIEW:\n${utils.json(review.findings ?? [])}`,
  }, specContext, { allowedPath: (target: string) => helpers.isTestPath(target) && helpers.inScope(target, stage.scope) });
  const tester = tested.result;
  const testChanges = repairIsTestOnly ? implementChanges : utils.changes(beforeTest, utils.runSnapshot(repo, record, file));
  const testViolations = testChanges.filter((target: string) => !helpers.isTestPath(target));
  helpers.addPhase(stage, 'test', tester, { observed_changed_paths: testChanges, attempted_changed_paths: tested.attempted, discarded_changed_paths: tested.discarded, scope_violations: testViolations });
  const evidence = [...runChecks(repo, config.workflow.test_commands, 'test'), ...runChecks(repo, config.workflow.quality_checks, 'quality')];
  helpers.addPhase(stage, 'engine_checks', evidence);
  const testPassed = tester.status === 'pass' && !testViolations.length && config.workflow.test_commands.length > 0 && evidence.some((item: any) => item.kind === 'test') && evidence.every((item: any) => item.passed);
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
    repo, text: `Validate the contract, test evidence, checks, rules, and scope. Missing checks fail; do not edit. Strata collected the supplied engine evidence in the target repository; treat it as authoritative. The target repository and its Git metadata are available, but do not change files.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nREQUIREMENTS:\n${utils.json(coordination.validation_requirements ?? [])}\nREVIEW:\n${utils.json(review)}\nTESTER:\n${utils.json(tester)}\nEVIDENCE:\n${utils.json(evidence)}`,
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
  const passed = reviewPassed && testPassed && validationPassed;
  return { passed, reason: passed ? '' : 'A required stage gate failed or required test evidence is unavailable', findings: { implementation: [], review: review.findings ?? [], test: tester.findings ?? [], validation: validation.findings ?? [], evidence } };
}
