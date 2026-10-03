import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';
import { agentStep } from './agentStep.js';
import { canEditProjectPath } from './editPolicy.js';
import { workflowChecks } from './checks.js';

export async function repairGate(repo: string, record: any, stage: any, config: any, file: string,
  context: string, role: string, gate: string, findings: unknown, task = '', memoryHandoff = '') {
  const agent = role === 'implementation' ? 'Implement Agent' : role === 'tests' ? 'Test Agent' : role;
  const phase = role === 'implementation' ? 'implement_repair' : role === 'tests' ? 'test_repair' : `repair_${role.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const subtype: 'implement' | 'test' | 'custom' = role === 'implementation' ? 'implement' : role === 'tests' ? 'test' : 'custom';
  const attempt = record.events.filter((event: any) => event.type === 'repair' && event.stage_id === stage.id && event.details?.gate === gate).length + 1;
  record.events.push({ type: 'repair', stage_id: stage.id, attempt, details: { gate, role, findings }, at: utils.now() });
  const before = utils.runSnapshot(repo, record, file);
  const allowedPath = (target: string) => canEditProjectPath(target, repo, record, file);
  const hasTestCommand = workflowChecks(config.workflow).some((check: any) => check.kind === 'test');
  const verifyInstruction = gate === 'test'
    ? hasTestCommand
      ? 'Do not rerun configured project checks. Fix the reported cause using the recorded evidence; Strata will rerun configured checks once after your repair.'
      : 'Fix the reported test issue, then run the narrowest relevant test command available. Do not run the repository-wide suite unless necessary.'
    : 'Report the repair and any remaining findings before handing off.';
  const result = await agentStep(record, file, subtype, stage.id, () => utils.askScoped(config, agent, {
    repo,
    text: `Repair the ${gate} issue (repair ${attempt}) using the findings and evidence below. The assigned edit agent may change task-relevant project files needed to satisfy a stage deliverable. Do not create report, summary, coverage, or handoff files; return that context in your structured response. Preserve unrelated work, specs, memory, and run records. Fix the underlying cause; never weaken a test or hide a production defect. ${verifyInstruction}\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nRELEVANT MEMORY HANDOFF:\n${memoryHandoff || 'No relevant memory identified.'}\nROUTED TASK:\n${task}\nGATE FINDINGS:\n${utils.json(findings)}`,
  }, context, {
    allowedPath,
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
