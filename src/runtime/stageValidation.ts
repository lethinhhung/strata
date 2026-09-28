import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';

export async function validateStage(repo: string, record: any, stage: any, config: any, file: string, context: string, coordination: any, review: any, tester: any, evidence: any[], changedPaths: string[]) {
  const criteria = stage.completion_criteria ?? [];
  const diff = helpers.reviewDiff(repo, changedPaths, stage.checkpoint_commit);
  const before = utils.runSnapshot(repo, record, file);
  const validation = await utils.askReadOnly(config, 'Validator', {
    repo,
    shape: '{"status":"pass|fail","acceptance_criteria":[{"criterion":"...","status":"pass|fail","evidence":"..."}],"findings":[]}',
    text: `Fresh-context final validation. Inspect the implementation and test diff/code against the Stage Contract and EVERY acceptance criterion. Return one evidence-backed result per criterion. Verify Tester evidence, review findings, scope, rules, and whether evidence proves each criterion; passing tests alone do not establish specification compliance. Do not edit anything.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nCRITERIA:\n${utils.json(criteria)}\nDIFF:\n${diff}\nREVIEW:\n${utils.json(review)}\nTESTER RESULT AND ENGINE EVIDENCE:\n${utils.json({ tester, evidence })}`,
  }, context, { strong: true });
  const mutations = utils.changes(before, utils.runSnapshot(repo, record, file));
  helpers.addPhase(stage, 'validate', validation, { observed_changed_paths: mutations });
  utils.save(record, file);
  if (mutations.length) throw new RunError(`Validator modified files: ${mutations.join(', ')}`);
  const results = validation.acceptance_criteria;
  const criteriaPass = Array.isArray(results) && results.length === criteria.length && criteria.every((criterion: string) => {
    const result = results.find((item: any) => item.criterion === criterion);
    return result?.status === 'pass' && typeof result.evidence === 'string' && result.evidence.trim().length > 0;
  });
  return { validation, passed: validation.status === 'pass' && criteriaPass && !mutations.length };
}
