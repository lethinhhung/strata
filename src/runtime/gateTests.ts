import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { runChecks, setupChecks, workflowChecks } from './checks.js';

export async function runTestGate(args: any) {
  const { repo, record, stage, config, file, context, coordination } = args;
  const checks = workflowChecks(config.workflow);
  const requiredTests = checks.filter((item: any) => item.kind === 'test' && !item.allow_unavailable);
  let tester = args.tester;
  let used = args.used ?? 0;
  let evidence = args.initialEvidence ?? await collectEvidence(args);
  helpers.addPhase(stage, 'engine_checks', evidence);
  let passed = testPass(args, tester, evidence, requiredTests);
  record.progress.push({ type: 'gate', subtype: 'test', stage_id: stage.id, timestamp: utils.now(), passed });
  utils.save(record, file);
  while (!passed && used < args.limit) {
    used += 1;
    const testAgentFailed = args.testViolations.length > 0 ||
      (config.workflow.require_agent_gates && tester.status !== 'pass' && evidence.every((item: any) => item.gate_passed));
    const role = testAgentFailed ? 'tests' : 'implementation';
    const findings = { tester: tester.findings ?? [], checks: evidence.filter((item: any) => !item.gate_passed) };
    const repair = await args.repair(role, findings);
    if (role === 'tests') tester = repair.result;
    else await args.reviewAfterSourceRepair();
    evidence = await collectEvidence(args);
    helpers.addPhase(stage, 'engine_checks', evidence);
    passed = testPass(args, tester, evidence, requiredTests);
    record.progress.push({ type: 'gate', subtype: 'test', stage_id: stage.id, timestamp: utils.now(), passed });
    utils.save(record, file);
  }
  return { tester, evidence, passed, used };
}

export async function createTests(args: any) {
  const { repo, record, stage, config, file, context, coordination, setupEvidence, review } = args;
  const before = utils.runSnapshot(repo, record, file);
  record.progress.push({ type: 'agent', subtype: 'test', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  const tested = await utils.askScoped(config, 'Test Agent', {
    repo,
    text: `Create deterministic tests for this stage; edit test files only. Setup commands ran before this phase. If setup failed, report the exact blocker. Do not claim checks passed without evidence.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nTASK:\n${coordination.test_task}\nSETUP EVIDENCE:\n${utils.json(setupEvidence)}\nREVIEW FINDINGS:\n${utils.json(review.findings ?? [])}`,
  }, context, { allowedPath: (target: string) => helpers.isTestPath(target) });
  const changed = utils.changes(before, utils.runSnapshot(repo, record, file));
  const violations = [...changed.filter((target: string) => !helpers.isTestPath(target)), ...tested.discarded];
  helpers.addPhase(stage, 'test', tested.result, {
    observed_changed_paths: changed, attempted_changed_paths: tested.attempted,
    discarded_changed_paths: tested.discarded, scope_violations: violations,
  });
  utils.save(record, file);
  return { result: tested.result, violations };
}

async function collectEvidence(args: any) {
  const { repo, stage } = args;
  const evidence = [...runChecks(repo, setupChecks(args.config.workflow), 'setup'), ...runChecks(repo, workflowChecks(args.config.workflow))];
  return evidence;
}

function testPass(args: any, tester: any, evidence: any[], requiredTests: any[]) {
  return !args.testViolations.length && requiredTests.length > 0 && evidence.every((item: any) => item.gate_passed) &&
    (!args.config.workflow.require_agent_gates || tester.status === 'pass');
}
