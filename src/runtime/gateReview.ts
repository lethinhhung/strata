import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';
import { agentStep } from './agentStep.js';

export async function reviewStage(args: any) {
  return reviewOnce(args);
}

async function reviewOnce(args: any) {
  const { repo, record, stage, config, file, context, sourceChanges } = args;
  const before = utils.runSnapshot(repo, record, file);
  let review: any;
  let agentError = false;
  try {
    review = await agentStep(record, file, 'review', stage.id, () => utils.askReadOnly(config, 'Review Agent', {
      repo,
      text: `Review the production diff against the stage objective, specs, and repo rules. For product-spec changes, trace every new normative requirement to the epic, an existing project requirement, or an explicit user-approved decision; flag invented defaults, unnecessary detail, and repeated requirements. Do not edit files. Assess necessary project configuration, manifest, lockfile, and integration changes by their relevance to the objective. Every created or modified file must be necessary to a deliverable in the stage contract. Flag unnecessary files, especially reports, summaries, coverage outputs, and handoff documents not explicitly required by the contract. Flag other changes that are unrelated or unnecessary. Ignore unrelated dirty files.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nRELEVANT MEMORY HANDOFF:\n${args.coordination.memory_handoff ?? 'No relevant memory identified.'}\nREVIEW FOCUS:\n${utils.json(args.coordination.review_focus ?? [])}\nSTAGE PATH AUDIT:\n${utils.json(stagePathAudit(stage))}\nDIFF:\n${helpers.reviewDiff(repo, sourceChanges, stage.checkpoint_commit)}`,
    }, context, {}));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    review = { status: 'fail', summary: 'Review Agent could not complete', findings: [message] };
    agentError = true;
  }
  const mutations = utils.changes(before, utils.runSnapshot(repo, record, file));
  helpers.addPhase(stage, 'review', review, { observed_changed_paths: mutations });
  utils.save(record, file);
  if (mutations.length) throw new RunError(`Review Agent modified files: ${mutations.join(', ')}`);
  const passed = review.status === 'pass' && !(review.findings ?? []).some((item: any) => ['critical', 'major'].includes(String(item.severity).toLowerCase()));
  record.progress.push({ type: 'gate', subtype: 'review', stage_id: stage.id, timestamp: utils.now(), passed });
  return { review, passed, agent_error: agentError };
}

function stagePathAudit(stage: any) {
  return (stage.phase_results ?? []).map((phase: any) => ({
    phase: phase.phase, observed_changed_paths: phase.observed_changed_paths ?? [],
    attempted_changed_paths: phase.attempted_changed_paths ?? [], discarded_changed_paths: phase.discarded_changed_paths ?? [],
    scope_violations: phase.scope_violations ?? [],
  }));
}
