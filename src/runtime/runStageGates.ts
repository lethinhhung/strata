import * as utils from './utils.js';
import { repairGate } from './gateRepair.js';
import { reviewStage } from './gateReview.js';
import { createTests } from './gateTests.js';
import { runChecks, setupChecks, workflowChecks } from './checks.js';
import { validateStage } from './gateValidation.js';
import { isTestPath } from './testPath.js';

/**
 * Run test authoring and review together, then evaluate configured checks and
 * validation. The runtime routes gate failures directly to a repair agent.
 */
export async function runStageGates(repo: string, record: any, stage: any, config: any, file: string,
  context: string, coordination: any, _repairContext: string, repairRound: number, _implementation: any,
  _implementationAttempt: any, _implementChanges: string[], sourceChanges: string[]) {
  const sourcePaths = [...sourceChanges];
  const checks = workflowChecks(config.workflow);
  const setup = setupChecks(config.workflow);
  const reviewArgs = {
    repo, record, stage, config, file, context, coordination, sourceChanges: sourcePaths,
  };

  let setupEvidence = runChecks(repo, setup, 'setup');
  let review: any;
  let testAgent: any;
  const priorTest = [...stage.phase_results].reverse().find((phase: any) => phase.phase === 'test');
  const runReview = () => coordination.run_review === false
    ? Promise.resolve({ review: { status: 'skipped', findings: [] }, passed: true })
    : reviewStage(reviewArgs);
  const runTests = () => coordination.run_tests === false
    ? Promise.resolve({ result: { status: 'skipped', findings: [] }, violations: [] })
    : createTests({ repo, record, stage, config, file, context, coordination, setupEvidence });
  // Avoid concurrent writes when the implementer already touched test files.
  if (sourcePaths.some(isTestPath)) {
    testAgent = await runTests();
    review = await runReview();
  } else if (repairRound > 1 && priorTest) {
    review = await runReview();
    testAgent = { result: priorTest.result, violations: priorTest.scope_violations ?? [] };
  } else {
    [review, testAgent] = await Promise.all([runReview(), runTests()]);
  }
  let evidence = [...setupEvidence, ...runChecks(repo, checks)];
  recordCheckGate(record, stage, file, evidence);

  while (true) {
    const validation = coordination.run_validation === false
      ? { validation: { status: 'skipped', findings: [] }, passed: true }
      : await validateStage({ repo, record, stage, config, file, context, coordination, review: review.review, tester: testAgent.result, evidence });
    const failedChecks = evidence.filter((item: any) => !item.gate_passed);
    const testFailed = testAgent.result.status === 'fail' || testAgent.violations.length > 0;
    if (!failedChecks.length && !testFailed && review.passed && validation.passed) {
      return { passed: true, reason: '', findings: { review: review.review, validation: validation.validation, evidence } };
    }
    const gate = failedChecks.length || testFailed ? 'test' : review.passed === false ? 'review' : 'validation';
    const limitKey = gate === 'test' ? 'test_repair_attempts' : gate === 'review' ? 'review_repair_attempts' : 'validation_repair_attempts';
    const repairCount = record.events.filter((event: any) => event.type === 'repair' && event.stage_id === stage.id && event.details?.gate === gate && event.details?.round === repairRound).length;
    const limit = repairRound > 1 ? 1 : config.workflow[limitKey] ?? 3;
    if (repairCount >= limit) {
      const openIssues = [
        ...(review.review.findings ?? []).filter(() => review.passed === false).map((finding: any) => `Review: ${typeof finding === 'string' ? finding : JSON.stringify(finding)}`),
        ...(!review.passed && !(review.review.findings ?? []).length ? ['Review did not pass; no actionable finding was returned.'] : []),
        ...(testFailed ? (testAgent.result.findings ?? []).map((finding: any) => `Test agent: ${typeof finding === 'string' ? finding : JSON.stringify(finding)}`) : []),
        ...(testAgent.violations.length ? [`Test agent attempted protected paths: ${testAgent.violations.join(', ')}`] : []),
        ...failedChecks.map((check: any) => `Check ${check.id} failed: ${(check.stderr || check.stdout || check.error || 'non-zero exit').slice(-1000)}`),
        ...(validation.validation.findings ?? []).filter(() => validation.passed === false).map((finding: any) => `Validation: ${typeof finding === 'string' ? finding : JSON.stringify(finding)}`),
        ...(!validation.passed && !(validation.validation.findings ?? []).length ? ['Validation did not pass; no actionable finding was returned.'] : []),
      ].filter(Boolean);
      stage.open_issues = [...new Set(openIssues)];
      return { passed: false, reason: `Repair cycle limit reached for ${gate}; stage remains open`, findings: { review: review.review, tester: testAgent.result, validation: validation.validation, evidence, open_issues: stage.open_issues } };
    }
    const routedFindings = {
      review: review.review,
      tester: testAgent.result,
      test_scope_violations: testAgent.violations,
      validation: validation.validation,
      failed_checks: failedChecks,
      evidence,
    };
    const testAgentOnlyFailure = gate === 'test' && !failedChecks.length;
    const role = testAgentOnlyFailure ? 'tests' : 'implementation';
    const repairTask = `Fix the ${gate} findings using the evidence above. Preserve passing requirements. Do not rerun project commands; Strata reruns configured checks after a repair changes files.`;
    const repaired = await repairGate(repo, record, stage, config, file, context, role,
      gate, routedFindings, repairTask, coordination.memory_handoff ?? '', repairRound);
    stage.accepted_paths = [...new Set([...(stage.accepted_paths ?? []), ...repaired.changed])];
    if (role !== 'tests') {
      for (const target of repaired.changed) if (!sourcePaths.includes(target)) sourcePaths.push(target);
    } else {
      testAgent = { result: repaired.result, violations: [] };
    }

    const changed = repaired.changed;
    if (changed.some(isDependencyPath)) setupEvidence = runChecks(repo, setup, 'setup');
    if (changed.length) {
      evidence = [...setupEvidence, ...runChecks(repo, checks)];
      recordCheckGate(record, stage, file, evidence);
      for (const target of changed) if (!sourcePaths.includes(target)) sourcePaths.push(target);
      review = coordination.run_review === false
        ? { review: { status: 'skipped', findings: [] }, passed: true }
        : await reviewStage(reviewArgs);
    }
  }
}

function recordCheckGate(record: any, stage: any, file: string, evidence: any[]) {
  const passed = evidence.every((item: any) => item.gate_passed);
  record.progress.push({ type: 'gate', subtype: 'test', stage_id: stage.id, timestamp: utils.now(), passed });
  utils.save(record, file);
}

function isDependencyPath(filePath: string) {
  return /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/.test(filePath);
}
