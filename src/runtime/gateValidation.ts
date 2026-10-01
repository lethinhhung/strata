import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';
import { agentStep } from './agentStep.js';

export async function validateStage(args: any) {
  const { repo, record, stage, config, file, context } = args;
  const before = utils.runSnapshot(repo, record, file);
  let validation: any;
  let agentError = false;
  try {
    validation = await agentStep(record, file, 'validate', stage.id, () => utils.askReadOnly(config, 'Validate Agent', {
      repo,
      text: `Validate contract coverage, review resolution, configured checks, rules, and scope. Do not edit. Engine gate_passed values are authoritative. A required test check must exist; a command that exits nonzero fails. Ignore unrelated dirty files and use the recorded stage path audit.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nREQUIREMENTS:\n${utils.json(args.coordination.validation_requirements ?? [])}\nSTAGE PATH AUDIT:\n${utils.json(stagePathAudit(stage))}\nREVIEW:\n${utils.json(args.review)}\nTESTER:\n${utils.json(args.tester)}\nEVIDENCE:\n${utils.json(args.evidence)}`,
    }, context, {}));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    validation = { status: 'fail', summary: 'Validate Agent could not complete', findings: [message] };
    agentError = true;
  }
  const mutations = utils.changes(before, utils.runSnapshot(repo, record, file));
  helpers.addPhase(stage, 'validate', validation, { observed_changed_paths: mutations });
  utils.save(record, file);
  if (mutations.length) throw new RunError(`Validate Agent modified files: ${mutations.join(', ')}`);
  const passed = validation.status === 'pass';
  record.progress.push({ type: 'gate', subtype: 'validation', stage_id: stage.id, timestamp: utils.now(), passed });
  return { validation, passed, agent_error: agentError };
}

export async function routeValidationRepair(args: any, validation: any) {
  const { record, stage, config, file, context } = args;
  return agentStep(record, file, 'stage_coordinator', stage.id, () => utils.askReadOnly(config, 'Stage Coordinator', {
    repo: args.repo,
    shape: '{"repair_role":"implementation|tests","repair_task":"...","rationale":"..."}',
    text: `Route this validation failure to the role that can fix its cause. Choose tests only when implementation meets the contract and the defect is missing or incorrect test coverage/expectations; otherwise choose implementation. Give a concrete repair task and rationale. Do not edit files.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nVALIDATION FINDINGS:\n${utils.json(validation.findings ?? [])}\nTESTER FINDINGS:\n${utils.json(args.tester.findings ?? [])}\nENGINE EVIDENCE:\n${utils.json(args.evidence)}`,
  }, context, { strong: true }));
}

function stagePathAudit(stage: any) {
  return (stage.phase_results ?? []).map((phase: any) => ({
    phase: phase.phase, observed_changed_paths: phase.observed_changed_paths ?? [],
    attempted_changed_paths: phase.attempted_changed_paths ?? [], discarded_changed_paths: phase.discarded_changed_paths ?? [],
    scope_violations: phase.scope_violations ?? [],
  }));
}
