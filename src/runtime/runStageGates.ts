import { runChecks, setupChecks, workflowChecks } from './checks.js';
import { repairGate } from './gateRepair.js';
import { reviewWithRepairs } from './gateReview.js';
import { createTests, runTestGate } from './gateTests.js';
import { routeValidationRepair, validateStage } from './gateValidation.js';

export async function runStageGates(repo: string, record: any, stage: any, config: any, file: string,
  context: string, coordination: any, _repairContext: string, _implementation: any,
  _implementationAttempt: any, _implementChanges: string[], sourceChanges: string[]) {
  const sourcePaths = [...sourceChanges];
  const reviewArgs = { repo, record, stage, config, file, context, coordination, sourceChanges: sourcePaths,
    required: config.workflow.require_agent_gates, limit: config.workflow.review_repair_attempts ?? 8 };
  const repair = async (role: 'implementation' | 'tests', findings: unknown, gate: string, task = '') => {
    const result = await repairGate(repo, record, stage, config, file, context, role, gate, findings, task);
    if (role === 'implementation') for (const target of result.changed) if (!sourcePaths.includes(target)) sourcePaths.push(target);
    return result;
  };
  let review = await reviewWithRepairs({ ...reviewArgs, repair: (findings: unknown) => repair('implementation', findings, 'review') });
  if (config.workflow.require_agent_gates && !review.passed) return failure(review, undefined, undefined, 'review');
  const setupEvidence = runChecks(repo, setupChecks(config.workflow), 'setup');
  const initialTest = await createTests({ repo, record, stage, config, file, context, coordination, setupEvidence, review: review.review });
  const checks = workflowChecks(config.workflow);
  const initialEvidence = [...setupEvidence, ...runChecks(repo, checks)];
  let tests = await runTestGate({ repo, record, stage, config, file, context, coordination, tester: initialTest.result,
    testViolations: initialTest.violations, initialEvidence, limit: config.workflow.test_repair_attempts ?? 8, repair,
    reviewAfterSourceRepair: async () => {
      review = await reviewWithRepairs({ ...reviewArgs, used: review.used, repair: (findings: unknown) => repair('implementation', findings, 'review') });
    } });
  if (!tests.passed) return failure(review, tests, undefined, 'test');
  let validation = await validateStage({ repo, record, stage, config, file, context, coordination,
    review: review.review, tester: tests.tester, evidence: tests.evidence });
  let validationRepairs = 0;
  while (config.workflow.require_agent_gates && !validation.passed && validationRepairs < (config.workflow.validation_repair_attempts ?? 8)) {
    validationRepairs += 1;
    if (validation.agent_error) {
      validation = await validateStage({ repo, record, stage, config, file, context, coordination,
        review: review.review, tester: tests.tester, evidence: tests.evidence });
      continue;
    }
    const route = await routeValidationRepair({ repo, record, stage, config, file, context, tester: tests.tester, evidence: tests.evidence }, validation.validation);
    const role = route.repair_role === 'tests' ? 'tests' : 'implementation';
    const repaired = await repair(role, { validation: validation.validation, evidence: tests.evidence }, 'validation', route.repair_task ?? '');
    if (role === 'implementation') {
      review = await reviewWithRepairs({ ...reviewArgs, used: review.used, repair: (findings: unknown) => repair('implementation', findings, 'review') });
      if (config.workflow.require_agent_gates && !review.passed) break;
    } else {
      tests = { ...tests, tester: repaired.result, passed: false };
    }
    tests = await runTestGate({ repo, record, stage, config, file, context, coordination, tester: tests.tester,
      testViolations: [], limit: (config.workflow.test_repair_attempts ?? 8) - tests.used, used: tests.used, repair,
      reviewAfterSourceRepair: async () => {
        review = await reviewWithRepairs({ ...reviewArgs, used: review.used, repair: (findings: unknown) => repair('implementation', findings, 'review') });
      } });
    if (!tests.passed) break;
    validation = await validateStage({ repo, record, stage, config, file, context, coordination,
      review: review.review, tester: tests.tester, evidence: tests.evidence });
  }
  const passed = tests.passed && (!config.workflow.require_agent_gates || (review.passed && validation.passed));
  if (passed) return { passed: true, reason: '', findings: {} };
  const failedGate = !review.passed && config.workflow.require_agent_gates ? 'review'
    : !tests.passed ? 'test' : 'validation';
  return failure(review, tests, validation, failedGate);
}

function failure(review: any, tests: any, validation: any, gate: string) {
  const findings = { failed_gate: gate, review: review.review.findings ?? [], test: tests?.tester.findings ?? [],
    validation: validation?.validation.findings ?? [], evidence: tests?.evidence ?? [] };
  const blockedChecks = (tests?.evidence ?? []).filter((item: any) => !item.gate_passed).map((item: any) => item.id);
  const detail = gate === 'test' && blockedChecks.length ? `; failed checks: ${blockedChecks.join(', ')}` : '';
  return { passed: false, repair_exhausted: true, reason: `Repair budget exhausted for ${gate} gate${detail}`, findings };
}
