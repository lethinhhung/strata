import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';

export async function reviewWithRepairs(args: any) {
  let used = args.used ?? 0;
  let result = await reviewOnce(args);
  while (args.required && !result.passed && used < args.limit) {
    used += 1;
    const repaired = await args.repair(result.review.findings ?? []);
    for (const target of repaired.changed) if (!args.sourceChanges.includes(target)) args.sourceChanges.push(target);
    result = await reviewOnce(args);
  }
  return { ...result, used };
}

async function reviewOnce(args: any) {
  const { repo, record, stage, config, file, context, coordination, sourceChanges } = args;
  const before = utils.runSnapshot(repo, record, file);
  record.progress.push({ type: 'agent', subtype: 'review', stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  const review = await utils.askReadOnly(config, 'Review Agent', {
    repo,
    text: `Review the production diff against the stage contract, specs, and repo rules. Do not edit files. The supplied diff and phase paths define this stage's scope; ignore unrelated dirty files.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nREVIEW FOCUS:\n${utils.json(args.coordination.review_focus ?? [])}\nSTAGE PATH AUDIT:\n${utils.json(stagePathAudit(stage))}\nDIFF:\n${helpers.reviewDiff(repo, sourceChanges, stage.checkpoint_commit)}`,
  }, context, {});
  const mutations = utils.changes(before, utils.runSnapshot(repo, record, file));
  helpers.addPhase(stage, 'review', review, { observed_changed_paths: mutations });
  utils.save(record, file);
  if (mutations.length) throw new RunError(`Review Agent modified files: ${mutations.join(', ')}`);
  const passed = review.status === 'pass' && !(review.findings ?? []).some((item: any) => ['critical', 'major'].includes(String(item.severity).toLowerCase()));
  record.progress.push({ type: 'gate', subtype: 'review', stage_id: stage.id, timestamp: utils.now(), passed });
  return { review, passed };
}

function stagePathAudit(stage: any) {
  return (stage.phase_results ?? []).map((phase: any) => ({
    phase: phase.phase, observed_changed_paths: phase.observed_changed_paths ?? [],
    attempted_changed_paths: phase.attempted_changed_paths ?? [], discarded_changed_paths: phase.discarded_changed_paths ?? [],
    scope_violations: phase.scope_violations ?? [],
  }));
}
