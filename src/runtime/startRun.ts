import { RunError, RunRecord } from './types.js';
import * as utils from './utils.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { executeRun } from './executeRun.js';
import { agentStep } from './agentStep.js';

export async function startRun(repo: string, epicPath: string, config: any, onProgress?: (entry: any) => void, inlinePrompt?: string, branchIn?: string, reviewPlan = false) {
  const isInline = typeof inlinePrompt === 'string';
  const absoluteEpic = isInline ? '' : path.resolve(repo, epicPath);
  if (isInline && !inlinePrompt.trim()) throw new RunError('Inline epic prompt must not be empty');
  if (!isInline && (!fs.existsSync(absoluteEpic) || !fs.statSync(absoluteEpic).isFile())) throw new RunError(`Epic file not found: ${absoluteEpic}`);
  if (utils.git(repo, ['rev-parse', '--is-inside-work-tree']).stdout.trim() !== 'true') throw new RunError('Target directory must be a Git worktree');
  if (branchIn?.trim()) {
    const branchExists = utils.git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branchIn}`], { allowFailure: true }).status === 0;
    const switched = utils.git(repo, ['switch', ...(branchExists ? [] : ['-c']), branchIn], { allowFailure: true });
    if (switched.status !== 0) throw new RunError(`Could not switch to branch ${branchIn}: ${switched.stderr.trim()}`);
  }
  const branch = utils.git(repo, ['branch', '--show-current']).stdout.trim();
  if (!branch) throw new RunError('Runs require a named Git branch');
  if (branch === 'main' || branch === 'master') throw new RunError('Huge-feature runs must use a working branch, not the default branch');
  const allowedPaths = [config.path, ...(absoluteEpic ? [absoluteEpic] : [])];
  if (utils.snapshot(repo, allowedPaths).size) throw new RunError('Start from a clean Git worktree apart from the Strata config and selected epic');
  const epic = isInline ? inlinePrompt! : fs.readFileSync(absoluteEpic, 'utf8');
  const memoryPaths = [config.workflow.memory_path, config.workflow.memory_policy].filter(Boolean);
  const specs = utils.phaseContext(repo, config);
  const id = utils.runId();
  const file = utils.recordPath(repo, id);
const record: RunRecord = {
       schema_version: 1,
       run_id: id,
       status: 'planning',
       created_at: utils.now(),
       repository: repo,
       epic,
       epic_path: isInline ? '(inline prompt)' : path.relative(repo, absoluteEpic),
       epic_absolute_path: absoluteEpic,
       config: config.path,
       memory_consulted: { paths: memoryPaths },
       stages: [],
       attempts: [],
       events: [],
       archival: undefined,
       progress: [],
       plan: undefined,
       updated_at: undefined,
       final_review: undefined,
       final_validation: undefined,
       final_evidence: undefined,
       final_validated_at: undefined,
       epic_checkpoint: undefined,
       completed_at: undefined,
       failure: undefined,
     };
    if (onProgress) Object.defineProperty(record, 'onProgress', { value: onProgress, configurable: true });
    record.progress.push({ type: 'run', subtype: 'start', timestamp: utils.now() });
    utils.save(record, file);
  try {
     const plan = await agentStep(record, file, 'epic_coordinator', 'epic', () => utils.askReadOnly(config, 'Epic Coordinator', {
       repo,
       shape: '{"summary":"...","decisions":[...],"stages":[{"id":"...","title":"...","concern":"...","dependencies":[],"completion_criteria":[...],"checkpoint":"stable identity"}]}',
       text: `Inspect the supplied epic, repository snapshot, and project instructions. Read relevant entries directly from the configured advisory memory paths; verify them against the current repository and keep them advisory. Decompose the epic into sequential, single-concern stages and make architecture decisions before implementation. Preserve the epic and existing project requirements; do not invent missing product behavior. Label low-impact, reversible implementation assumptions, and leave consequential user-visible, privacy, data, compatibility, or scope decisions unresolved instead of planning dependent implementation. Plan a product-spec edit only when explicitly requested or user-approved, and limit it to confirmed behavior without adding design details or duplicating requirements. Keep data/API/business logic distinct from user-facing screens/components/navigation; UI stages may consume existing logic but must not add backend behavior. Put logic before UI that depends on it. Each stage should describe an independently reviewable outcome and include related production and test work when needed. Never create a test-only stage. Agents have two permission modes: edit or read-only. Assign edit permission based on the task; do not impose role-specific file ownership. Do not implement.\nEPIC:\n${epic}\n\nSPECIFICATIONS:\n${specs}\n\nCONFIGURED MEMORY PATHS:\n${utils.json(memoryPaths)}\n\nBranch: ${utils.git(repo, ['branch', '--show-current']).stdout.trim()}\nTracked files:\n${utils.git(repo, ['ls-files']).stdout.slice(0, 20_000)}`,
     }, specs, { strong: true }));
     record.plan = { summary: plan.summary ?? '', decisions: plan.decisions ?? [] };
     record.stages = utils.validatePlan(plan);
     record.status = 'planned';
     utils.save(record, file);
    if (reviewPlan) return record;
    await executeRun(repo, record, config, file);
    return record;
  } catch (error) {
    if (record.status !== 'complete') {
      record.status = 'failed';
      record.failure = { message: error instanceof Error ? error.message : String(error), timestamp: utils.now() };
      record.progress.push({ type: 'run', subtype: 'fail', timestamp: utils.now() });
      record.updated_at = utils.now();
      utils.save(record, file);
    }
    throw error;
  }
}
