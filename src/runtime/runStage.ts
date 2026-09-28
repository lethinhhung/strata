import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';
import { runChecks } from './checks.js';
export async function runStage(repo: string, record: any, stage: any, config: any, file: string, { repairContext = '', repairRole = 'Implement Agent' } = {}) {
  stage.status = 'in_progress';
  utils.save(record, file);
  const specContext = utils.phaseContext(repo, config);
  const beforeExplore = utils.runSnapshot(repo, record, file);
  const exploration = await utils.askReadOnly(config, 'Explore Agent', {
    repo,
    shape: '{"status":"pass|fail","findings":[],"files":[],"summary":"...","uncertainties":[]}',
    text: `Read-only repository investigation for this stage. Locate relevant files, conventions, tests, APIs, and dependencies. Do not edit files or decide architecture. Stage contract:\n${utils.json(helpers.stageContract(stage))}`,
  }, specContext, {});
  const afterExplore = utils.runSnapshot(repo, record, file);
  const explorationMutation = utils.changes(beforeExplore, afterExplore);
helpers.addPhase(stage, 'explore', exploration, { observed_changed_paths: explorationMutation }); utils.save(record, file);
  if (explorationMutation.length) throw new RunError(`Explore Agent modified files: ${explorationMutation.join(', ')}`);

  const coordination = await utils.askReadOnly(config, 'Stage Coordinator', {
    repo,
    shape: '{"implementation_task":"...","review_focus":[...],"test_task":"...","validation_requirements":[...],"memory_handoff":"..."}',
    text: `Coordinate this stage with a fresh context. Do not implement. Convert the contract into bounded work for the implementer, reviewer, tester, and validator; select only relevant memory and record the handoff. Assign production source files to the Implement Agent and test files to the Test Agent. The Implement Agent must never be tasked with editing tests, and the Test Agent must never be tasked with editing production source. When repairing a failed test gate, assign the test expectation or coverage repair to the Test Agent. Include prior phase results and any repair findings.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nEXPLORE FINDINGS:\n${utils.json(exploration)}\nMEMORY:\n${record.memory_consulted.excerpt}\nPRIOR RESULTS:\n${utils.json(stage.phase_results)}\nREPAIR FINDINGS:\n${repairContext}`,
  }, specContext, { strong: true });
  helpers.addPhase(stage, 'stage_coordination', coordination);
  utils.save(record, file);
  const beforeImplement = utils.runSnapshot(repo, record, file);
  const repairIsTestOnly = repairRole === 'Test Agent';
  const implementationAttempt = await utils.askScoped(config, repairIsTestOnly ? 'Test Agent' : 'Implement Agent', {
    repo,
    text: repairIsTestOnly
      ? `Repair only the reported test expectations or coverage. Edit test files only; do not change production source.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nCOORDINATOR TASK:\n${coordination.test_task}\nREPAIR FINDINGS:\n${repairContext}`
      : `Implement the source change within this stage scope. Edit production source files only. Do not edit tests, specs, memory, run records, or unrelated files, even if the coordinator task asks for test edits; those belong to the Test Agent. Return observed changed paths and checks. If this is a repair, fix only the reported source findings.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nCOORDINATOR TASK:\n${coordination.implementation_task}\nREPAIR FINDINGS:\n${repairContext}`,
  }, specContext, {
    allowedPath: (filePath: string) => (repairIsTestOnly ? helpers.isTestPath(filePath) : !helpers.isTestPath(filePath)) &&
      !filePath.startsWith('specs/') && filePath !== record.epic_path && helpers.inScope(filePath, stage.scope),
  });
  const implementation = implementationAttempt.result;
  const implementChanges = utils.changes(beforeImplement, utils.runSnapshot(repo, record, file));
  // Retained in-scope edits count when a repair makes no further source changes.
  const retainedSourceChanges = [...utils.runSnapshot(repo, record, file).keys()]
    .filter((filePath: string) => !helpers.isTestPath(filePath) && !filePath.startsWith('specs/') &&
      filePath !== record.epic_path && helpers.inScope(filePath, stage.scope));
  if (stage.checkpoint_commit) {
    const checkpointedPaths = utils.git(repo, ['show', '--format=', '--name-only', stage.checkpoint_commit]).stdout
      .split('\n').map((filePath: string) => filePath.trim()).filter(Boolean)
      .filter((filePath: string) => !helpers.isTestPath(filePath) && !filePath.startsWith('specs/') &&
        filePath !== record.epic_path && helpers.inScope(filePath, stage.scope));
    retainedSourceChanges.push(...checkpointedPaths);
  }
  const uniqueRetainedSourceChanges = [...new Set(retainedSourceChanges)].sort();
  const effectiveImplementChanges = (repairIsTestOnly ? uniqueRetainedSourceChanges : implementChanges.length ? implementChanges : uniqueRetainedSourceChanges).filter((filePath: string) =>
    !helpers.isTestPath(filePath) && !filePath.startsWith('specs/') && filePath !== record.epic_path && helpers.inScope(filePath, stage.scope));
  helpers.addPhase(stage, 'implement', implementation, {
    observed_changed_paths: implementChanges,
    attempted_changed_paths: implementationAttempt.attempted,
    discarded_changed_paths: implementationAttempt.discarded,
  });
  const implementationViolations = implementChanges.filter((filePath: string) =>
    (repairIsTestOnly ? !helpers.isTestPath(filePath) : helpers.isTestPath(filePath)) || filePath.startsWith('specs/') || filePath === record.epic_path || !helpers.inScope(filePath, stage.scope));
  utils.save(record, file);
  if (implementationViolations.length) throw new RunError(`Implementer changed files outside its source scope: ${implementationViolations.join(', ')}`);
  if (implementation.status !== 'pass' || (!repairIsTestOnly && !effectiveImplementChanges.length)) {
    const discarded = implementationAttempt.discarded.length
      ? `; discarded out-of-role writes: ${implementationAttempt.discarded.join(', ')}` : '';
    return { passed: false, reason: `Implementation failed or produced no in-scope source changes${discarded}`, findings: implementation.findings ?? [] };
  }
  const beforeReview = utils.runSnapshot(repo, record, file);
  const review = await utils.askReadOnly(config, 'Review Agent', {
    repo,
    text: `Review only the production-source diff read-only against the stage contract, specs, and repo rules. Pass only with no critical or major issue in the source change. The Test Agent runs after this review and owns all test-file edits; do not fail review because required tests have not yet been added or updated. Do not edit files.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nREVIEW FOCUS:\n${utils.json(coordination.review_focus ?? [])}\nProduction-source diff:\n${helpers.reviewDiff(repo, effectiveImplementChanges, stage.checkpoint_commit)}`,
  }, specContext, {});
  const reviewMutations = utils.changes(beforeReview, utils.runSnapshot(repo, record, file));
  helpers.addPhase(stage, 'review', review, { observed_changed_paths: reviewMutations });
  utils.save(record, file);
  if (reviewMutations.length) throw new RunError(`Review Agent modified files: ${reviewMutations.join(', ')}`);

  const beforeTest = utils.runSnapshot(repo, record, file);
  const testerAttempt = repairIsTestOnly ? { result: implementation, attempted: implementationAttempt.attempted, discarded: implementationAttempt.discarded } : await utils.askScoped(config, 'Test Agent', {
    repo,
    text: `Create deterministic tests for required behavior. Change test files only; do not run checks in this disposable workspace because Strata will execute the configured commands in the repository afterward.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nCOORDINATOR TASK:\n${coordination.test_task}\nREVIEW FINDINGS:\n${utils.json(review.findings ?? [])}`,
  }, specContext, {
    allowedPath: (filePath: string) => helpers.isTestPath(filePath) && helpers.inScope(filePath, stage.scope),
  });
  const tester = testerAttempt.result;
  const testChanges = repairIsTestOnly ? implementChanges : utils.changes(beforeTest, utils.runSnapshot(repo, record, file));
  const testViolations = testChanges.filter((filePath: string) => !helpers.isTestPath(filePath));
  helpers.addPhase(stage, 'test', tester, {
    observed_changed_paths: testChanges,
    attempted_changed_paths: testerAttempt.attempted,
    discarded_changed_paths: testerAttempt.discarded,
    scope_violations: testViolations,
  });
  utils.save(record, file);
  const evidence = [
    ...runChecks(repo, config.workflow.test_commands, 'test'),
    ...runChecks(repo, config.workflow.quality_checks, 'quality'),
  ];
  helpers.addPhase(stage, 'engine_checks', evidence);
  utils.save(record, file);
  const beforeValidate = utils.runSnapshot(repo, record, file);
  const validation = await utils.askReadOnly(config, 'Validate Agent', {
    repo,
    text: `Read-only gate. Check spec coverage, review resolution, test evidence, configured quality checks, repository rules, and scope. A missing/skipped required check fails. Do not edit anything.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nCOORDINATOR REQUIREMENTS:\n${utils.json(coordination.validation_requirements ?? [])}\nREVIEW:\n${utils.json(review)}\nTESTER:\n${utils.json(tester)}\nENGINE EVIDENCE:\n${utils.json(evidence)}`,
  }, specContext, {});
  const validationMutations = utils.changes(beforeValidate, utils.runSnapshot(repo, record, file));
  helpers.addPhase(stage, 'validate', validation, { observed_changed_paths: validationMutations });
  utils.save(record, file);
  if (validationMutations.length) throw new RunError(`Validate Agent modified files: ${validationMutations.join(', ')}`);
  const passed = review.status === 'pass' && !(review.findings ?? []).some((item: any) => ['critical', 'major'].includes(String(item.severity).toLowerCase())) &&
    tester.status === 'pass' && !testViolations.length && config.workflow.test_commands.length > 0 &&
    evidence.some((item: any) => item.kind === 'test') && evidence.every((item: any) => item.passed) &&
    validation.status === 'pass' && !validationMutations.length;
  return {
    passed,
    reason: passed ? '' : 'A required stage gate failed or required test evidence is unavailable',
    findings: { implementation: implementation.findings ?? [], review: review.findings ?? [], test: tester.findings ?? [], validation: validation.findings ?? [], evidence },
  };
}
