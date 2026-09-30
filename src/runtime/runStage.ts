import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';
import { runStageGates } from './runStageGates.js';

export async function runStage(repo: string, record: any, stage: any, config: any, file: string, { repairContext = '', repairRole = 'Implement Agent' } = {}) {
  stage.status = 'in_progress';
  record.progress.push({ type: 'stage', subtype: 'in_progress', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  const specContext = utils.phaseContext(repo, config);
  const beforeExplore = utils.runSnapshot(repo, record, file);
  record.progress.push({ type: 'agent', subtype: 'explore', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  const exploration = await utils.askReadOnly(config, 'Explore Agent', {
    repo,
    shape: '{"status":"pass|fail","findings":[],"files":[],"summary":"...","uncertainties":[]}',
    text: `Read-only repository investigation for this stage. Locate relevant files, conventions, tests, APIs, and dependencies. Do not edit files or decide architecture. Stage contract:\n${utils.json(helpers.stageContract(stage))}`,
  }, specContext, {});
  const afterExplore = utils.runSnapshot(repo, record, file);
  const explorationMutation = utils.changes(beforeExplore, afterExplore);
  helpers.addPhase(stage, 'explore', exploration, { observed_changed_paths: explorationMutation }); utils.save(record, file);
  if (explorationMutation.length) throw new RunError(`Explore Agent modified files: ${explorationMutation.join(', ')}`);
 
  record.progress.push({ type: 'agent', subtype: 'stage_coordinator', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  const coordination = await utils.askReadOnly(config, 'Stage Coordinator', {
    repo,
    shape: '{"implementation_task":"...","review_focus":[...],"test_task":"...","validation_requirements":[...],"memory_handoff":"..."}',
    text: `Coordinate this stage with a fresh context. Do not implement. Convert the contract into bounded work for the implementer, reviewer, tester, and validator; select only relevant memory and record the handoff. Assign production source files to the Implement Agent and test files to the Test Agent. The Implement Agent must never be tasked with editing tests, and the Test Agent must never be tasked with editing production source. When repairing a failed test gate, assign the test expectation or coverage repair to the Test Agent. Include prior phase results and any repair findings.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nEXPLORE FINDINGS:\n${utils.json(exploration)}\nMEMORY:\n${record.memory_consulted.excerpt}\nPRIOR RESULTS:\n${utils.json(stage.phase_results)}\nREPAIR FINDINGS:\n${repairContext}`,
  }, specContext, { strong: true });
  helpers.addPhase(stage, 'stage_coordination', coordination);
  utils.save(record, file);
  const beforeImplement = utils.runSnapshot(repo, record, file);
  const repairIsTestOnly = repairRole === 'Test Agent';
  record.progress.push({ type: 'agent', subtype: repairIsTestOnly ? 'test' : 'implement', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
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
const retainedSourceChanges = [...Array.from(utils.runSnapshot(repo, record, file).keys())]
     .filter((filePath: string) => !helpers.isTestPath(filePath) && !filePath.startsWith('specs/') &&
       filePath !== record.epic_path && helpers.inScope(filePath, stage.scope));
  if (stage.checkpoint_commit) {
    const checkpointedPaths = utils.git(repo, ['show', '--format=', '--name-only', stage.checkpoint_commit]).stdout
      .split('\n').map((filePath: string) => filePath.trim()).filter(Boolean)
      .filter((filePath: string) => !helpers.isTestPath(filePath) && !filePath.startsWith('specs/') &&
        filePath !== record.epic_path && helpers.inScope(filePath, stage.scope));
    retainedSourceChanges.push(...checkpointedPaths);
  }
  const uniqueRetainedSourceChanges = Array.from(new Set(retainedSourceChanges)).sort();
  const effectiveImplementChanges = (repairIsTestOnly ? uniqueRetainedSourceChanges : implementChanges.length ? implementChanges : uniqueRetainedSourceChanges).filter((filePath: string) =>
    !helpers.isTestPath(filePath) && !filePath.startsWith('specs/') && filePath !== record.epic_path && helpers.inScope(filePath, stage.scope));
  helpers.addPhase(stage, 'implement', implementation, {
    observed_changed_paths: implementChanges,
    attempted_changed_paths: implementationAttempt.attempted,
    discarded_changed_paths: implementationAttempt.discarded,
  });
  const implementationViolations = implementationAttempt.discarded;
  utils.save(record, file);
  if (implementationViolations.length) throw new RunError(`Implementer attempted files outside its scope: ${implementationViolations.join(', ')}`);
  if (implementation.status !== 'pass' || (!repairIsTestOnly && !effectiveImplementChanges.length)) {
    const discarded = implementationAttempt.discarded.length
      ? `; discarded out-of-role writes: ${implementationAttempt.discarded.join(', ')}` : '';
    return { passed: false, reason: `Implementation failed or produced no in-scope source changes${discarded}`, findings: implementation.findings ?? [] };
  }
  return runStageGates(repo, record, stage, config, file, specContext, coordination, repairIsTestOnly,
    implementation, implementationAttempt, implementChanges, effectiveImplementChanges);
}
