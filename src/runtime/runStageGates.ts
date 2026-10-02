import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { repairGate } from './gateRepair.js';
import { reviewStage } from './gateReview.js';
import { createTests } from './gateTests.js';
import { runChecks, setupChecks, workflowChecks } from './checks.js';
import { validateStage } from './gateValidation.js';
import { agentStep } from './agentStep.js';

/**
 * Run specialist review and validation as separate calls. Their findings are
 * context for the Stage Coordinator; configured command evidence is evaluated
 * by the engine, and the coordinator chooses whether and how to repair.
 */
export async function runStageGates(repo: string, record: any, stage: any, config: any, file: string,
  context: string, coordination: any, _repairContext: string, _implementation: any,
  _implementationAttempt: any, _implementChanges: string[], sourceChanges: string[]) {
  const sourcePaths = [...sourceChanges];
  const checks = workflowChecks(config.workflow);
  const setup = setupChecks(config.workflow);
  const reviewArgs = {
    repo, record, stage, config, file, context, coordination, sourceChanges: sourcePaths,
  };

  let setupEvidence = runChecks(repo, setup, 'setup');
  let evidence = [...setupEvidence, ...runChecks(repo, checks)];
  let review = coordination.run_review === false
    ? { review: { status: 'skipped', findings: [] }, passed: true }
    : await reviewStage(reviewArgs);
  let testAgent = coordination.run_tests === false
    ? { result: { status: 'skipped', findings: [] }, violations: [] }
    : await createTests({ repo, record, stage, config, file, context, coordination, setupEvidence, review: review.review });
  setupEvidence = runChecks(repo, setup, 'setup');
  evidence = [...setupEvidence, ...runChecks(repo, checks)];
  recordCheckGate(record, stage, file, evidence);

  while (true) {
    const validation = coordination.run_validation === false
      ? { validation: { status: 'skipped', findings: [] }, passed: true }
      : await validateStage({ repo, record, stage, config, file, context, coordination, review: review.review, tester: testAgent.result, evidence });
    const decision = await coordinateGate(repo, record, stage, config, file, context, {
      coordination, review: review.review, tester: testAgent.result,
      test_scope_violations: testAgent.violations,
      validation: validation.validation, evidence,
      repairHistory: stage.phase_results.filter((item: any) => item.phase === 'implement_repair' || item.phase === 'test_repair' || item.phase.startsWith('repair_')),
    });

    const failedChecks = evidence.filter((item: any) => !item.gate_passed);
    if (!failedChecks.length && review.passed && validation.passed && decision.decision === 'ready') {
      return { passed: true, reason: '', findings: { review: review.review, validation: validation.validation, evidence } };
    }
    if (decision.decision === 'blocked' && !failedChecks.length && review.passed && validation.passed) {
      return {
        passed: false,
        blocked: true,
        reason: decision.rationale || 'Stage Coordinator identified a blocker; run is resumable',
        findings: { review: review.review, tester: testAgent.result, validation: validation.validation, evidence, decision },
      };
    }

    const role = typeof decision.repair_role === 'string' && decision.repair_role
      ? decision.repair_role : 'implementation';
    const gate = failedChecks.length ? 'test' : review.passed === false ? 'review' : 'validation';
    const limitKey = gate === 'test' ? 'test_repair_attempts' : gate === 'review' ? 'review_repair_attempts' : 'validation_repair_attempts';
    const repairCount = record.events.filter((event: any) => event.type === 'repair' && event.stage_id === stage.id && event.details?.gate === gate).length;
    const limit = config.workflow[limitKey] ?? 3;
    if (repairCount >= limit) {
      const openIssues = [
        ...(review.review.findings ?? []).filter((finding: any) => review.passed === false).map((finding: any) => `Review: ${typeof finding === 'string' ? finding : JSON.stringify(finding)}`),
        ...(!review.passed && !(review.review.findings ?? []).length ? ['Review did not pass; no actionable finding was returned.'] : []),
        ...failedChecks.map((check: any) => `Check ${check.id} failed: ${(check.stderr || check.stdout || check.error || 'non-zero exit').slice(-1000)}`),
        ...(validation.validation.findings ?? []).filter((finding: any) => validation.passed === false).map((finding: any) => `Validation: ${typeof finding === 'string' ? finding : JSON.stringify(finding)}`),
        ...(!validation.passed && !(validation.validation.findings ?? []).length ? ['Validation did not pass; no actionable finding was returned.'] : []),
        decision.rationale ? `Coordinator: ${decision.rationale}` : '',
      ].filter(Boolean);
      stage.open_issues = [...new Set(openIssues)];
      return { passed: true, reason: 'Repair cycle limit reached; committing with unresolved findings recorded', findings: { review: review.review, tester: testAgent.result, validation: validation.validation, evidence, decision, open_issues: stage.open_issues } };
    }
    const routedFindings = {
      coordinator_rationale: decision.rationale ?? '',
      repair_task: decision.repair_task ?? '',
      review: review.review,
      tester: testAgent.result,
      test_scope_violations: testAgent.violations,
      validation: validation.validation,
      failed_checks: failedChecks,
      evidence,
    };
    const repaired = await repairGate(repo, record, stage, config, file, context, role,
      gate, routedFindings, decision.repair_task ?? '', coordination.memory_handoff ?? '');
    stage.accepted_paths = [...new Set([...(stage.accepted_paths ?? []), ...repaired.changed])];
    if (role !== 'tests') {
      for (const target of repaired.changed) if (!sourcePaths.includes(target)) sourcePaths.push(target);
    } else {
      testAgent = { result: repaired.result, violations: [] };
    }

    setupEvidence = runChecks(repo, setup, 'setup');
    evidence = [...setupEvidence, ...runChecks(repo, checks)];
    recordCheckGate(record, stage, file, evidence);
    review = coordination.run_review === false
      ? { review: { status: 'skipped', findings: [] }, passed: true }
      : await reviewStage(reviewArgs);
  }
}

function recordCheckGate(record: any, stage: any, file: string, evidence: any[]) {
  const passed = evidence.every((item: any) => item.gate_passed);
  record.progress.push({ type: 'gate', subtype: 'test', stage_id: stage.id, timestamp: utils.now(), passed });
  utils.save(record, file);
}

async function coordinateGate(repo: string, record: any, stage: any, config: any, file: string,
  context: string, reports: any) {
  try {
    const result = await agentStep(record, file, 'stage_coordinator', stage.id, () => utils.askReadOnly(config, 'Stage Coordinator', {
    repo,
    shape: '{"decision":"ready|repair|blocked","repair_role":"project-defined agent role","repair_task":"...","rationale":"..."}',
    text: `Decide the next action for this stage using the project-defined policy. Specialist reports are opinions; interpret them against project rules and the stage contract. Planned scope is a focus guide; judge every changed path by its relevance to the objective, allowing necessary project configuration, manifests, lockfiles, and integration files outside planned scope. Configured command evidence is authoritative: if any command has gate_passed=false, do not choose ready; route a concrete repair to an edit-capable project role best able to fix the cause. Role titles do not restrict files. Choose ready when the contract is met and configured commands pass, even if a specialist report disagrees and you judge its concern inapplicable. Choose blocked only when you identify a concrete external or policy blocker that another agent action cannot repair. Do not edit files. Summarize check output to the actionable lines; the complete evidence is stored in the run record.
CONTRACT:
${utils.json(helpers.stageContract(stage))}
STAGE PLAN:
${utils.json(reports.coordination)}
LATEST REPORTS AND CHECK EVIDENCE:
${utils.json(compactReports(reports))}
STAGE PATH AUDIT:
${utils.json(stage.phase_results.map((phase: any) => ({ phase: phase.phase, observed_changed_paths: phase.observed_changed_paths ?? [], attempted_changed_paths: phase.attempted_changed_paths ?? [], discarded_changed_paths: phase.discarded_changed_paths ?? [] })))}`,
    }, utils.phaseContext(repo, config), { strong: true }));
    return normalizeDecision(result);
  } catch (error) {
    return { decision: 'blocked', rationale: `Could not obtain a Stage Coordinator decision: ${String(error)}` };
  }
}

function compactReports(reports: any) {
  const summarize = (value: any) => JSON.stringify(value ?? {}).slice(0, 6000);
  const evidence = (reports.evidence ?? []).map((item: any) => ({
    id: item.id, kind: item.kind, command: item.command, exit_code: item.exit_code,
    gate_passed: item.gate_passed, error: item.error,
    output: `${item.stdout ?? ''}\n${item.stderr ?? ''}`.slice(-2400),
  }));
  return {
    coordination: reports.coordination,
    review: summarize(reports.review),
    tester: summarize(reports.tester),
    test_scope_violations: reports.test_scope_violations,
    validation: summarize(reports.validation),
    evidence,
    repairHistory: (reports.repairHistory ?? []).slice(-5).map((item: any) => ({
      phase: item.phase, result: summarize(item.result),
      observed_changed_paths: item.observed_changed_paths,
    })),
  };
}

function normalizeDecision(result: any) {
  const decision = String(result?.decision ?? '').toLowerCase();
  if (decision === 'ready' || decision === 'blocked' || decision === 'repair') return { ...result, decision };
  // Missing structured output must never turn a failing command into success.
  return {
    decision: 'repair',
    repair_role: 'implementation',
    repair_task: 'The previous coordinator response did not include a valid decision. Re-examine the reported evidence and fix the outstanding issue.',
    rationale: 'Coordinator response was missing a valid decision.',
  };
}
