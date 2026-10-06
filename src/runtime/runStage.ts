import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';
import { runStageGates } from './runStageGates.js';
import { implementationCanProceed } from './implementationResult.js';
import { agentStep } from './agentStep.js';
import { canEditProjectPath } from './editPolicy.js';

export async function runStage(repo: string, record: any, stage: any, config: any, file: string, { repairContext = '', light = false, repairRound = 1 } = {}) {
  stage.status = 'in_progress';
  record.progress.push({ type: 'stage', subtype: 'in_progress', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  const specContext = utils.phaseContext(repo, config);
  let exploration: any = stage.phase_results.find((phase: any) => phase.phase === 'explore')?.result;
  if (!light || !exploration) {
    const beforeExplore = utils.runSnapshot(repo, record, file);
    exploration = await agentStep(record, file, 'explore', stage.id, () => utils.askReadOnly(config, 'Explore Agent', {
      repo,
      shape: '{"status":"pass|fail","findings":[],"files":[],"summary":"...","uncertainties":[]}',
      text: `Read-only repository investigation for this stage. Locate relevant files, conventions, tests, APIs, and dependencies. Do not edit files or decide architecture. The Stage Coordinator will inspect configured advisory memory as needed.\nSTAGE CONTRACT:\n${utils.json(helpers.stageContract(stage))}`,
    }, specContext, {}));
    const afterExplore = utils.runSnapshot(repo, record, file);
    const explorationMutation = utils.changes(beforeExplore, afterExplore);
    helpers.addPhase(stage, 'explore', exploration, { observed_changed_paths: explorationMutation }); utils.save(record, file);
    if (explorationMutation.length) throw new RunError(`Explore Agent modified files: ${explorationMutation.join(', ')}`);
  }

  let coordination: any = light ? [...stage.phase_results].reverse().find((phase: any) => phase.phase === 'stage_coordination')?.result : undefined;
  const reusedCoordination = Boolean(coordination);
  if (!coordination) coordination = await agentStep(record, file, 'stage_coordinator', stage.id, () => utils.askReadOnly(config, 'Stage Coordinator', {
    repo,
    shape: '{"implementation_tasks":[{"role":"implementer|screen_implementer","task":"..."}],"review_focus":[],"test_task":"...","validation_requirements":[],"memory_handoff":"..."}',
    text: `Coordinate this stage with a fresh context. Do not implement. Follow project role definitions and acceptance criteria. The runner implements first, then performs review and test authoring in parallel, runs configured checks, and validates the resulting tree. Do not skip a specialist or replace the pipeline with custom agent_tasks. Keep work directly relevant to the stage objective. Inspect configured advisory memory paths directly when useful, verify relevant entries against the current repository, and return a concise memory_handoff with source paths for implementation, review, test, validation, and repair agents. Return an ordered implementation_tasks list; each item must contain one focused task and role "implementer" or "screen_implementer". Split mixed backend/data and UI work into separate tasks, with backend/data first and UI second when it depends on the backend. Use multiple tasks for other independently bounded pieces when that improves focus; keep dependent tasks in dependency order. Then provide review focus, test task, validation requirements, and project-appropriate handoffs. Include prior repair findings. Pass summaries, findings, and handoff context in structured results and the run record; agents must not create extra report, summary, coverage, or handoff files. Require project files only when the stage contract calls for them. Treat prior agent reports and run history as claims, not repository facts: verify paths, package roots, scripts, and test inventory in the current repository before assigning work. Never infer that an agent-created or untracked path is an intended project package or existing test. Do not create new project roots or broaden the workspace to satisfy a path mentioned only in prior agent output.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nEXPLORE FINDINGS:\n${utils.json(exploration)}\nCONFIGURED MEMORY PATHS:\n${utils.json(record.memory_consulted.paths)}\nPRIOR RESULTS:\n${utils.json(stage.phase_results)}\nREPAIR FINDINGS:\n${repairContext}`,
  }, specContext, { strong: true }));
  coordination.run_review = true;
  coordination.run_tests = true;
  coordination.run_validation = true;
  if (!reusedCoordination) helpers.addPhase(stage, 'stage_coordination', coordination);
  utils.save(record, file);

  const beforeImplement = utils.runSnapshot(repo, record, file);
  const legacyRole = /\b(screen|ui|component|navigation|admin page|expo|native|web page|paywall|onboarding|landing|form)\b/i
    .test(`${stage.title} ${stage.concern} ${stage.completion_criteria.join(' ')}`) ? 'screen_implementer' : 'implementer';
  const tasks = Array.isArray(coordination.implementation_tasks) && coordination.implementation_tasks.length
    ? coordination.implementation_tasks
    : [{ role: legacyRole, task: coordination.implementation_task ?? 'Implement the stage contract.' }];
  const implementationResults: any[] = [];
  const attemptedPaths = new Set<string>();
  const discardedPaths = new Set<string>();
  for (let index = 0; index < tasks.length; index += 1) {
    const item = tasks[index];
    const role = item.role === 'screen_implementer' ? 'Screen Implementer' : 'Implement Agent';
    const task = typeof item.task === 'string' ? item.task : String(item.task ?? '');
    const attempt = await agentStep(record, file, 'implement', stage.id, () => utils.askScoped(config, role, {
      repo,
      text: `Implement or repair implementation task ${index + 1} of ${tasks.length} for this stage. Previous implementation tasks have completed in order and their changes are present. Make necessary related project configuration, manifests, lockfiles, integration, and source changes when required by the task. Keep changes relevant to the objective. Do not create report, summary, coverage, or handoff files; return that context in your structured response. Do not edit test files, specs, memory, run records, or unrelated files; the Test Agent owns test files. Use reported gate findings to fix the underlying cause, and avoid changing requirements to conceal a production defect. Run focused tests and quality checks when they help verify implementation; use the narrowest relevant commands when possible. Strata runs configured checks afterward and records those as authoritative gate results. Return changed paths, commands run, and check outcomes.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nCOORDINATOR TASK:\n${task}\nRELEVANT MEMORY HANDOFF:\n${coordination.memory_handoff ?? 'No relevant memory identified.'}\nREPAIR FINDINGS:\n${repairContext}`,
    }, specContext, {
      allowedPath: (filePath: string) => canEditProjectPath(filePath, repo, record, file),
    }), role);
    implementationResults.push({ role, task, result: attempt.result });
    attempt.attempted.forEach((filePath: string) => attemptedPaths.add(filePath));
    attempt.discarded.forEach((filePath: string) => discardedPaths.add(filePath));
    helpers.addPhase(stage, `implement_${index + 1}`, attempt.result, {
      task, role, attempted_changed_paths: attempt.attempted, discarded_changed_paths: attempt.discarded,
    });
    utils.save(record, file);
  }
  const implementationAttempt = {
    attempted: [...attemptedPaths].sort(), discarded: [...discardedPaths].sort(),
  };
  const implementation = {
    status: implementationResults.every((item) => item.result?.status === 'pass') ? 'pass' : 'fail',
    summary: implementationResults.map((item) => item.result?.summary).filter(Boolean).join('\n'),
    findings: implementationResults.flatMap((item) => item.result?.findings ?? []),
    handoffs: implementationResults.flatMap((item) => item.result?.handoffs ?? []),
    tasks: implementationResults,
  };
  const implementChanges = utils.changes(beforeImplement, utils.runSnapshot(repo, record, file));
  const retainedSourceChanges = [...(stage.accepted_paths ?? [])];
  if (stage.checkpoint_commit) {
    const checkpointedPaths = utils.git(repo, ['show', '--format=', '--name-only', stage.checkpoint_commit]).stdout
      .split('\n').map((filePath: string) => filePath.trim()).filter(Boolean)
      .filter((filePath: string) => (stage.accepted_paths ?? []).includes(filePath));
    retainedSourceChanges.push(...checkpointedPaths);
  }
  const effectiveImplementChanges = (implementChanges.length ? implementChanges : Array.from(new Set(retainedSourceChanges)).sort());
  helpers.addPhase(stage, 'implement', implementation, {
    observed_changed_paths: implementChanges,
    attempted_changed_paths: implementationAttempt.attempted,
    discarded_changed_paths: implementationAttempt.discarded,
  });
  stage.accepted_paths = [...new Set([...(stage.accepted_paths ?? []), ...implementChanges])];
  const implementationViolations = implementationAttempt.discarded;
  utils.save(record, file);
  if (implementationViolations.length) throw new RunError(`Stage agents attempted protected project files: ${implementationViolations.join(', ')}`);
  if (!implementationCanProceed(implementation.status, false, effectiveImplementChanges, Boolean(repairContext))) {
    return { passed: false, reason: 'Stage agents reported no changes relevant to the stage', findings: implementation.findings ?? implementation.handoffs ?? [] };
  }
  return runStageGates(repo, record, stage, config, file, specContext, coordination, repairContext, repairRound,
    implementation, implementationAttempt, implementChanges, effectiveImplementChanges);
}
