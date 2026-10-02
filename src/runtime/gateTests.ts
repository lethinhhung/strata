import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { agentStep } from './agentStep.js';
import { canEditProjectPath } from './editPolicy.js';

export async function createTests(args: any) {
  const { repo, record, stage, config, file, context, coordination, setupEvidence, review } = args;
  const before = utils.runSnapshot(repo, record, file);
  const tested = await agentStep(record, file, 'test', stage.id, () => utils.askScoped(config, 'Test Agent', {
    repo,
    text: `Create or update deterministic tests and make related project-file changes when needed to meet this stage's test criteria. Edit any relevant project files; do not change unrelated files or claim checks passed without evidence. Setup commands ran before this phase. If setup failed, report the exact blocker.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nRELEVANT MEMORY HANDOFF:\n${coordination.memory_handoff ?? 'No relevant memory identified.'}\nTASK:\n${coordination.test_task ?? ''}\nSETUP EVIDENCE:\n${utils.json(setupEvidence)}\nREVIEW FINDINGS:\n${utils.json(review.findings ?? [])}`,
  }, context, { allowedPath: (target: string) => canEditProjectPath(target, repo, record, file) }));
  const changed = utils.changes(before, utils.runSnapshot(repo, record, file));
  const violations = tested.discarded;
  stage.accepted_paths = [...new Set([...(stage.accepted_paths ?? []), ...changed])];
  helpers.addPhase(stage, 'test', tested.result, {
    observed_changed_paths: changed, attempted_changed_paths: tested.attempted,
    discarded_changed_paths: tested.discarded, scope_violations: violations,
  });
  utils.save(record, file);
  return { result: tested.result, violations };
}
