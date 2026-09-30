import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';

export async function repairGate(repo: string, record: any, stage: any, config: any, file: string,
  context: string, role: 'implementation' | 'tests', gate: string, findings: unknown, task = '') {
  const agent = role === 'implementation' ? 'Implement Agent' : 'Test Agent';
  const phase = role === 'implementation' ? 'implement_repair' : 'test_repair';
  const subtype = role === 'implementation' ? 'implement' : 'test';
  const attempt = record.events.filter((event: any) => event.type === 'repair' && event.stage_id === stage.id && event.details?.gate === gate).length + 1;
  record.events.push({ type: 'repair', stage_id: stage.id, attempt, details: { gate, role, findings }, at: utils.now() });
  const before = utils.runSnapshot(repo, record, file);
  record.progress.push({ type: 'agent', subtype, stage_id: stage.id, timestamp: utils.now() });
  utils.save(record, file);
  const result = await utils.askScoped(config, agent, {
    repo,
    text: `Repair the ${gate} gate (repair ${attempt}) using the exact findings and evidence below. Work only on the assigned role's files and stay within stage scope. Fix the underlying cause; never weaken a test or hide a production defect. After edits, report what changed and what still blocks the gate.\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nROUTED TASK:\n${task}\nGATE FINDINGS:\n${utils.json(findings)}`,
  }, context, {
    allowedPath: (target: string) => role === 'tests'
      // Test repairs may need to fix a failing test outside the stage's
      // production/configuration scope. Keep the role boundary strict while
      // allowing the Test Agent to edit test files anywhere in the repository.
      ? helpers.isTestPath(target)
      : !helpers.isTestPath(target) && !target.startsWith('specs/') && target !== record.epic_path && helpers.inScope(target, stage.scope),
  });
  const changed = utils.changes(before, utils.runSnapshot(repo, record, file));
  const violations = result.discarded;
  helpers.addPhase(stage, phase, result.result, {
    observed_changed_paths: changed,
    attempted_changed_paths: result.attempted,
    discarded_changed_paths: violations,
    scope_violations: violations,
  });
  utils.save(record, file);
  if (violations.length) throw new RunError(`${agent} attempted files outside its assigned scope: ${violations.join(', ')}`);
  return { result: result.result, changed };
}
