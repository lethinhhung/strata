import { RunError, RunRecord } from './types.js';
import * as utils from './utils.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { executeRun } from './executeRun.js';

export async function startRun(repo: string, epicPath: string, config: any, onProgress?: (entry: any) => void) {
  const absoluteEpic = path.resolve(repo, epicPath);
  if (!fs.existsSync(absoluteEpic) || !fs.statSync(absoluteEpic).isFile()) throw new RunError(`Epic file not found: ${absoluteEpic}`);
  if (utils.git(repo, ['rev-parse', '--is-inside-work-tree']).stdout.trim() !== 'true') throw new RunError('Target directory must be a Git worktree');
  if (utils.snapshot(repo, [config.path, absoluteEpic]).size) throw new RunError('Start from a clean Git worktree apart from the Strata config and selected epic');
  const epic = fs.readFileSync(absoluteEpic, 'utf8');
  const memoryPaths = [config.workflow.memory_path, config.workflow.memory_policy].filter(Boolean);
  const memory = utils.readTree(repo, memoryPaths, 12_000);
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
       epic_path: path.relative(repo, absoluteEpic),
       epic_absolute_path: absoluteEpic,
       config: config.path,
       memory_consulted: { paths: memoryPaths, excerpt: memory },
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
    record.progress.push({ type: 'agent', subtype: 'epic_coordinator', stage_id: 'epic', timestamp: utils.now() });
    utils.save(record, file);
    const plan = await utils.askReadOnly(config, 'Epic Coordinator', {
      repo,
      shape: '{"summary":"...","decisions":[...],"stages":[{"id":"...","title":"...","concern":"...","scope":["path or glob"],"dependencies":[],"completion_criteria":[...],"checkpoint":"stable identity"}]',
      text: `Inspect the supplied epic, repository snapshot, specifications, and advisory memory. Make architecture decisions and finish the stable stage plan before implementation. Every scope must be a non-empty list of repository paths or glob patterns. Do not implement.\nEPIC:\n${epic}\n\nSPECIFICATIONS:\n${specs}\n\nADVISORY MEMORY:\n${memory}\n\nBranch: ${utils.git(repo, ['branch', '--show-current']).stdout.trim()}\nTracked files:\n${utils.git(repo, ['ls-files']).stdout.slice(0, 20_000)}`,
    }, specs, { strong: true });
    record.plan = { summary: plan.summary ?? '', decisions: plan.decisions ?? [] };
    record.stages = utils.validatePlan(plan);
    record.status = 'planned';
    utils.save(record, file);
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
