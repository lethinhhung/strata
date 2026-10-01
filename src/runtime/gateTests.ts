import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { agentStep } from './agentStep.js';

export async function createTests(args: any) {
  const { repo, record, stage, config, file, context, coordination, setupEvidence, review } = args;
  const before = utils.runSnapshot(repo, record, file);
  const tested = await agentStep(record, file, 'test', stage.id, () => utils.askScoped(config, 'Test Agent', {
    repo,
    text: `Create or update deterministic tests for this stage when the project workflow calls for them; edit test files only. Setup commands ran before this phase. If setup failed, report the exact blocker. Do not claim checks passed without evidence.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nTASK:\n${coordination.test_task ?? ''}\nSETUP EVIDENCE:\n${utils.json(setupEvidence)}\nREVIEW FINDINGS:\n${utils.json(review.findings ?? [])}`,
  }, context, { allowedPath: (target: string) => helpers.isTestPath(target) }));
  const changed = utils.changes(before, utils.runSnapshot(repo, record, file));
  const violations = [...changed.filter((target: string) => !helpers.isTestPath(target)), ...tested.discarded];
  stage.accepted_paths = [...new Set([...(stage.accepted_paths ?? []), ...changed.filter((target: string) => helpers.isTestPath(target))])];
  helpers.addPhase(stage, 'test', tested.result, {
    observed_changed_paths: changed, attempted_changed_paths: tested.attempted,
    discarded_changed_paths: tested.discarded, scope_violations: violations,
  });
  utils.save(record, file);
  return { result: tested.result, violations };
}
