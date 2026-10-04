import * as fs from 'node:fs';
import * as path from 'node:path';
import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { agentStep } from './agentStep.js';
import { canEditProjectPath } from './editPolicy.js';
import { workflowChecks } from './checks.js';

function belongsToTrackedPackage(target: string, repo: string, tracked: Set<string>) {
  const normalized = target.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) return false;
  let directory = path.posix.dirname(normalized);
  while (true) {
    const manifest = directory === '.' ? 'package.json' : `${directory}/package.json`;
    if (fs.existsSync(path.join(repo, manifest))) return tracked.has(manifest);
    const parent = path.posix.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

export async function createTests(args: any) {
  const { repo, record, stage, config, file, context, coordination, setupEvidence } = args;
  const before = utils.runSnapshot(repo, record, file);
  const tracked = new Set(utils.git(repo, ['ls-files', '-z']).stdout.split('\0').filter(Boolean));
  const configured = workflowChecks(config.workflow).filter((check: any) => check.kind === 'test');
  const checkHandoff = configured.length
    ? `Strata will run these configured test checks after test authoring; do not run them yourself:\n${configured.map((check: any) => `- ${check.command.join(' ')}`).join('\n')}`
    : 'No test command is configured. Run the narrowest relevant project test command if one is available; do not run the repository-wide suite unless this stage requires it.';
  const tested = await agentStep(record, file, 'test', stage.id, () => utils.askScoped(config, 'Test Agent', {
    repo,
    text: `Create or update deterministic tests for this stage. Focus on test files, and make related project changes only when the task or test evidence requires them. Keep every change relevant to the stage; do not edit specs, memory, run records, or unrelated files. Do not create summary, report, coverage, or handoff files; return those details in your structured response. Avoid duplicating Strata's configured command runs. ${checkHandoff}\nCONTRACT:\n${utils.json(helpers.stageContract(stage))}\nRELEVANT MEMORY HANDOFF:\n${coordination.memory_handoff ?? 'No relevant memory identified.'}\nTASK:\n${coordination.test_task ?? ''}\nSETUP EVIDENCE:\n${utils.json(setupEvidence)}`,
  }, context, { allowedPath: (target: string) => canEditProjectPath(target, repo, record, file) && belongsToTrackedPackage(target, repo, tracked) }));
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
