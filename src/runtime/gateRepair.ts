import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';
import { agentStep } from './agentStep.js';
import { canEditProjectPath } from './editPolicy.js';

export async function repairGate(repo: string, record: any, stage: any, config: any, file: string,
  context: string, role: string, gate: string, findings: unknown, task = '', memoryHandoff = '') {
  const agent = role === 'implementation' ? 'Implement Agent' : role === 'tests' ? 'Test Agent' : role;
  const phase = role === 'implementation' ? 'implement_repair' : role === 'tests' ? 'test_repair' : `repair_${role.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const subtype: 'implement' | 'test' | 'custom' = role === 'implementation' ? 'implement' : role === 'tests' ? 'test' : 'custom';
  const attempt = record.events.filter((event: any) => event.type === 'repair' && event.stage_id === stage.id && event.details?.gate === gate).length + 1;
  record.events.push({ type: 'repair', stage_id: stage.id, attempt, details: { gate, role, findings }, at: utils.now() });
  const before = utils.runSnapshot(repo, record, file);
  const verifyInstruction = gate === 'test'
    ? 'For a test-gate repair, run every failing command after each fix and keep fixing/rerunning until it passes or you identify a concrete blocker. Do this before handing off; Strata will rerun the checks independently immediately after your repair.'
    : 'Report the repair and any remaining findings before handing off.';
  const result = await agentStep(record, file, subtype, stage.id, () => utils.askScoped(config, agent, {
    repo,
    text: `Repair the ${gate} issue (repair ${attempt}) using the findings and evidence below. The assigned edit agent may change any task-relevant project files; the original stage scope is context, not a file ownership boundary or repair limit. Preserve unrelated work, specs, memory, and run records. Fix the underlying cause; never weaken a test or hide a production defect. ${verifyInstruction}\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nRELEVANT MEMORY HANDOFF:\n${memoryHandoff || 'No relevant memory identified.'}\nROUTED TASK:\n${task}\nGATE FINDINGS:\n${utils.json(findings)}`,
  }, context, {
    allowedPath: (target: string) => canEditProjectPath(target, repo, record, file),
  }), role);
  const changed = utils.changes(before, utils.runSnapshot(repo, record, file));
  stage.accepted_paths = [...new Set([...(stage.accepted_paths ?? []), ...changed])];
  const violations = result.discarded;
  helpers.addPhase(stage, phase, result.result, {
    observed_changed_paths: changed,
    attempted_changed_paths: result.attempted,
    discarded_changed_paths: violations,
    scope_violations: violations,
  });
  utils.save(record, file);
  if (violations.length) throw new RunError(`${agent} attempted protected project files: ${violations.join(', ')}`);
  return { result: result.result, changed };
}
