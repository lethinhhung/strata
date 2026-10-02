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
      text: `Assess contract coverage, review resolution, configured checks, and project rules as a specialist report for the Stage Coordinator. Do not edit or rerun commands; Strata runs configured commands and the supplied engine evidence is authoritative. A test check is not required when the project has none. Treat planned scope as a guide and assess expanded paths for relevance to the objective. Ignore unrelated dirty files and use the recorded stage path audit.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nRELEVANT MEMORY HANDOFF:\n${args.coordination.memory_handoff ?? 'No relevant memory identified.'}\nREQUIREMENTS:\n${utils.json(args.coordination.validation_requirements ?? [])}\nSTAGE PATH AUDIT:\n${utils.json(stagePathAudit(stage))}\nREVIEW:\n${utils.json(args.review)}\nTESTER:\n${utils.json(args.tester)}\nEVIDENCE:\n${utils.json(args.evidence)}`,
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

function stagePathAudit(stage: any) {
  return (stage.phase_results ?? []).map((phase: any) => ({
    phase: phase.phase, observed_changed_paths: phase.observed_changed_paths ?? [],
    attempted_changed_paths: phase.attempted_changed_paths ?? [], discarded_changed_paths: phase.discarded_changed_paths ?? [],
    scope_violations: phase.scope_violations ?? [],
  }));
}
