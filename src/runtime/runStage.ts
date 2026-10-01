import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';
import { runStageGates } from './runStageGates.js';
import { implementationCanProceed } from './implementationResult.js';
import { agentStep } from './agentStep.js';

export async function runStage(repo: string, record: any, stage: any, config: any, file: string, { repairContext = '' } = {}) {
  stage.status = 'in_progress';
  record.progress.push({ type: 'stage', subtype: 'in_progress', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  const specContext = utils.phaseContext(repo, config);
  const beforeExplore = utils.runSnapshot(repo, record, file);
  const exploration = await agentStep(record, file, 'explore', stage.id, () => utils.askReadOnly(config, 'Explore Agent', {
    repo,
    shape: '{"status":"pass|fail","findings":[],"files":[],"summary":"...","uncertainties":[]}',
    text: `Read-only repository investigation for this stage. Locate relevant files, conventions, tests, APIs, and dependencies. Do not edit files or decide architecture. Stage contract:\n${utils.json(helpers.stageContract(stage))}`,
  }, specContext, {}));
  const afterExplore = utils.runSnapshot(repo, record, file);
  const explorationMutation = utils.changes(beforeExplore, afterExplore);
  helpers.addPhase(stage, 'explore', exploration, { observed_changed_paths: explorationMutation }); utils.save(record, file);
  if (explorationMutation.length) throw new RunError(`Explore Agent modified files: ${explorationMutation.join(', ')}`);

  const coordination = await agentStep(record, file, 'stage_coordinator', stage.id, () => utils.askReadOnly(config, 'Stage Coordinator', {
    repo,
    shape: '{"agent_tasks":[{"role":"project-defined role","task":"...","read_only":false}],"run_review":true,"run_tests":true,"run_validation":true,"implementation_task":"...","review_focus":[],"test_task":"...","validation_requirements":[],"memory_handoff":"..."}',
    text: `Coordinate this stage with a fresh context. Do not implement. Follow project role definitions and acceptance criteria. You may create an ordered agent_tasks list using any project-defined roles; each task must be concrete and in this stage's scope. Mark read_only when a role should not edit. Decide whether the default review, test-authoring, and validation specialists are useful with run_review, run_tests, and run_validation. If there are no custom agent_tasks, provide implementation_task for the default Implement Agent. Include project-appropriate handoffs and prior repair findings.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nEXPLORE FINDINGS:\n${utils.json(exploration)}\nMEMORY:\n${record.memory_consulted.excerpt}\nPRIOR RESULTS:\n${utils.json(stage.phase_results)}\nREPAIR FINDINGS:\n${repairContext}`,
  }, specContext, { strong: true }));
  helpers.addPhase(stage, 'stage_coordination', coordination);
  utils.save(record, file);

  const beforeImplement = utils.runSnapshot(repo, record, file);
  let implementation: any;
  let implementationAttempt: any;
  if (Array.isArray(coordination.agent_tasks) && coordination.agent_tasks.length) {
    const handoffs: any[] = [];
    const attempted: string[] = [];
    const discarded: string[] = [];
    for (const task of coordination.agent_tasks) {
      if (!task || typeof task.role !== 'string' || !task.role.trim() || typeof task.task !== 'string') {
        throw new RunError('Stage Coordinator returned an invalid agent_tasks entry');
      }
      const role = task.role.trim();
      const result = await agentStep(record, file, 'custom', stage.id, () => utils.askScoped(config, role, {
        repo,
        text: `Complete your assigned project role task within the stage contract and your project role definition. Preserve unrelated work and report concrete changes and outcomes.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nASSIGNED TASK:\n${task.task}\nPRIOR AGENT HANDOFFS:\n${utils.json(handoffs)}\nREPAIR FINDINGS:\n${repairContext}`,
      }, specContext, {
        allowedPath: (filePath: string) => !task.read_only && helpers.inScope(filePath, stage.scope) &&
          !filePath.startsWith('specs/') && !filePath.startsWith('memory/') &&
          !filePath.startsWith('docs/temps/') && filePath !== record.epic_path && filePath !== file,
      }), role);
      handoffs.push({ role, result: result.result, attempted: result.attempted, discarded: result.discarded });
      attempted.push(...result.attempted);
      discarded.push(...result.discarded);
      helpers.addPhase(stage, `agent_${role.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, result.result, {
        observed_changed_paths: result.applied,
        attempted_changed_paths: result.attempted,
        discarded_changed_paths: result.discarded,
      });
      utils.save(record, file);
    }
    implementation = { status: 'pass', findings: [], handoffs };
    implementationAttempt = { attempted, discarded };
  } else {
    implementationAttempt = await agentStep(record, file, 'implement', stage.id, () => utils.askScoped(config, 'Implement Agent', {
      repo,
      text: `Implement or repair the source change within this stage scope. Edit production source files only. Do not edit tests, specs, memory, run records, or unrelated files. Use the reported gate findings to fix the underlying cause, and avoid changing tests to conceal a production defect. Return observed changed paths and checks.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nCOORDINATOR TASK:\n${coordination.implementation_task}\nREPAIR FINDINGS:\n${repairContext}`,
    }, specContext, {
      allowedPath: (filePath: string) => isAllowedRolePath(filePath, false, stage, record),
    }));
    implementation = implementationAttempt.result;
  }

  const implementChanges = utils.changes(beforeImplement, utils.runSnapshot(repo, record, file));
  const retainedSourceChanges = [...Array.from(utils.runSnapshot(repo, record, file).keys())]
    .filter((filePath: string) => helpers.inScope(filePath, stage.scope));
  if (stage.checkpoint_commit) {
    const checkpointedPaths = utils.git(repo, ['show', '--format=', '--name-only', stage.checkpoint_commit]).stdout
      .split('\n').map((filePath: string) => filePath.trim()).filter(Boolean)
      .filter((filePath: string) => helpers.inScope(filePath, stage.scope));
    retainedSourceChanges.push(...checkpointedPaths);
  }
  const effectiveImplementChanges = (implementChanges.length ? implementChanges : Array.from(new Set(retainedSourceChanges)).sort());
  helpers.addPhase(stage, 'implement', implementation, {
    observed_changed_paths: implementChanges,
    attempted_changed_paths: implementationAttempt.attempted,
    discarded_changed_paths: implementationAttempt.discarded,
  });
  const implementationViolations = implementationAttempt.discarded;
  utils.save(record, file);
  if (implementationViolations.length) throw new RunError(`Agent attempted files outside its assigned scope: ${implementationViolations.join(', ')}`);
  if (!implementationCanProceed(implementation.status, false, effectiveImplementChanges, Boolean(repairContext))) {
    return { passed: false, reason: 'Stage agents reported no in-scope changes', findings: implementation.findings ?? implementation.handoffs ?? [] };
  }
  return runStageGates(repo, record, stage, config, file, specContext, coordination, repairContext,
    implementation, implementationAttempt, implementChanges, effectiveImplementChanges);
}

function isAllowedRolePath(filePath: string, testOnly: boolean, stage: any, record: any) {
  if (helpers.isTestPath(filePath) !== testOnly || filePath.startsWith('specs/') || filePath === record.epic_path) return false;
  // Failed checks can concern existing project-wide tests, while initial production work stays stage-scoped.
  return testOnly || helpers.inScope(filePath, stage.scope);
}
