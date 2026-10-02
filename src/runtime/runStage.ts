import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';
import { runStageGates } from './runStageGates.js';
import { implementationCanProceed } from './implementationResult.js';
import { agentStep } from './agentStep.js';
import { canEditProjectPath } from './editPolicy.js';

export async function runStage(repo: string, record: any, stage: any, config: any, file: string, { repairContext = '' } = {}) {
  stage.status = 'in_progress';
  record.progress.push({ type: 'stage', subtype: 'in_progress', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  const specContext = utils.phaseContext(repo, config);
  const beforeExplore = utils.runSnapshot(repo, record, file);
  const exploration = await agentStep(record, file, 'explore', stage.id, () => utils.askReadOnly(config, 'Explore Agent', {
    repo,
    shape: '{"status":"pass|fail","findings":[],"files":[],"summary":"...","uncertainties":[]}',
    text: `Read-only repository investigation for this stage. Locate relevant files, conventions, tests, APIs, and dependencies. Do not edit files or decide architecture. Treat advisory memory as clues to verify against the current repository.\nADVISORY MEMORY:\n${record.memory_consulted.excerpt}\nSTAGE CONTRACT:\n${utils.json(helpers.stageContract(stage))}`,
  }, specContext, {}));
  const afterExplore = utils.runSnapshot(repo, record, file);
  const explorationMutation = utils.changes(beforeExplore, afterExplore);
  helpers.addPhase(stage, 'explore', exploration, { observed_changed_paths: explorationMutation }); utils.save(record, file);
  if (explorationMutation.length) throw new RunError(`Explore Agent modified files: ${explorationMutation.join(', ')}`);

  const coordination = await agentStep(record, file, 'stage_coordinator', stage.id, () => utils.askReadOnly(config, 'Stage Coordinator', {
    repo,
    shape: '{"implementation_task":"...","review_focus":[],"test_task":"...","validation_requirements":[],"memory_handoff":"..."}',
    text: `Coordinate this stage with a fresh context. Do not implement. Follow project role definitions and acceptance criteria. The runner implements first, then performs review and test authoring in parallel, runs configured checks, and validates the resulting tree. Do not skip a specialist or replace the pipeline with custom agent_tasks. Treat stage scope as a focus guide, not a hard file boundary. Select only relevant advisory memory and return it as a concise memory_handoff for implementation, review, test, validation, and repair agents; preserve source paths and verify relevance against the current repository. Give the implementer one concrete task, then provide review focus, test task, validation requirements, and project-appropriate handoffs. Include prior repair findings.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nEXPLORE FINDINGS:\n${utils.json(exploration)}\nMEMORY:\n${record.memory_consulted.excerpt}\nPRIOR RESULTS:\n${utils.json(stage.phase_results)}\nREPAIR FINDINGS:\n${repairContext}`,
  }, specContext, { strong: true }));
  coordination.run_review = true;
  coordination.run_tests = true;
  coordination.run_validation = true;
  helpers.addPhase(stage, 'stage_coordination', coordination);
  utils.save(record, file);

  const beforeImplement = utils.runSnapshot(repo, record, file);
  const implementerRole = stage.kind === 'ui' ? 'Screen Implementer' : 'Implement Agent';
  const implementationAttempt = await agentStep(record, file, 'implement', stage.id, () => utils.askScoped(config, implementerRole, {
    repo,
    text: `Implement or repair the assigned work for this stage. Stage scope is the planned focus, not a hard file boundary; make necessary related project configuration, manifests, lockfiles, integration, and source changes when required by the task. Keep changes relevant to the objective. Do not edit test files, specs, memory, run records, or unrelated files; the Test Agent owns test files. Use reported gate findings to fix the underlying cause, and avoid changing requirements to conceal a production defect. Do not rerun configured project checks; Strata runs them after this phase. Return changed paths and any checks you did not run.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nCOORDINATOR TASK:\n${coordination.implementation_task}\nRELEVANT MEMORY HANDOFF:\n${coordination.memory_handoff ?? 'No relevant memory identified.'}\nREPAIR FINDINGS:\n${repairContext}`,
  }, specContext, {
    allowedPath: (filePath: string) => canEditProjectPath(filePath, repo, record, file),
  }), implementerRole);
  const implementation = implementationAttempt.result;

  const implementChanges = utils.changes(beforeImplement, utils.runSnapshot(repo, record, file));
  const retainedSourceChanges = [...Array.from(utils.runSnapshot(repo, record, file).keys())]
    .filter((filePath: string) => helpers.inScope(filePath, stage.scope) || (stage.accepted_paths ?? []).includes(filePath));
  if (stage.checkpoint_commit) {
    const checkpointedPaths = utils.git(repo, ['show', '--format=', '--name-only', stage.checkpoint_commit]).stdout
      .split('\n').map((filePath: string) => filePath.trim()).filter(Boolean)
      .filter((filePath: string) => helpers.inScope(filePath, stage.scope) || (stage.accepted_paths ?? []).includes(filePath));
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
  return runStageGates(repo, record, stage, config, file, specContext, coordination, repairContext,
    implementation, implementationAttempt, implementChanges, effectiveImplementChanges);
}
