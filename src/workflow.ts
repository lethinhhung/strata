import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { StrataConfig } from './config.js';
import { invoke, jsonResponse, run } from './provider.js';

type Stage = { id: string; title: string; objective: string; dependencies: string[]; completion_criteria: string[]; status?: string; attempts?: any[] };
type RecordData = { id: string; status: string; created_at: string; updated_at: string; repo: string; epic: string; epic_file: string; branch: string; stages: Stage[]; history: any[]; error?: string };

export async function startRun(repo: string, epic: string, epicFile: string, config: StrataConfig): Promise<RecordData> {
  const gitRoot = await run('git', ['rev-parse', '--show-toplevel'], repo, 10000);
  if (gitRoot.code !== 0) throw new Error(`Target repository is not a Git worktree: ${repo}`);
  const branchResult = await run('git', ['branch', '--show-current'], repo, 10000);
  const branch = branchResult.stdout.trim();
  if (!branch) throw new Error('Strata runs require a named current branch. Check out a working branch first.');
  const dirty = await run('git', ['status', '--porcelain', '--untracked-files=all'], repo, 10000);
  const selectedEpic = epicFile === '(inline epic)' ? '' : path.relative(repo, path.resolve(epicFile));
  const unexpectedChanges = dirty.stdout.split('\n').filter(Boolean).filter((line) => {
    const changedPath = line.slice(3).split(' -> ').at(-1) ?? '';
    return changedPath !== '.strata.toml' && (!selectedEpic || changedPath !== selectedEpic);
  });
  if (unexpectedChanges.length) throw new Error(`Target repository must be clean apart from its selected epic and Strata config: ${unexpectedChanges.join(', ')}`);

  const id = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
  const promptFile = path.join(repo, 'prompt', 'epic.md');
  fs.mkdirSync(path.dirname(promptFile), { recursive: true });
  fs.writeFileSync(promptFile, `${epic.trim()}\n`, 'utf8');
  const record: RecordData = { id, status: 'planning', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), repo, epic, epic_file: epicFile, branch, stages: [], history: [] };
  const file = path.join(repo, 'docs', 'temps', `${id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const save = () => { record.updated_at = new Date().toISOString(); fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`); };
  save();
  try {
    const context = projectContext(repo, config);
    const explorationPlan = jsonResponse(await invokeReadOnly(config.strong, promptFor('epic_coordinator', {
      task: 'Identify up to three focused repository exploration questions needed to plan the epic. Do not plan stages or implement. Return JSON {"exploration_tasks":[{"question":"..."}]}.',
      epic, context,
    }), repo));
    const explorationTasks: any[] = Array.isArray(explorationPlan.exploration_tasks) && explorationPlan.exploration_tasks.length
      ? explorationPlan.exploration_tasks.slice(0, 3)
      : [{ question: 'Inspect the repository specifications, conventions, and implementation areas relevant to this epic.' }];
    const initialFindings: string[] = [];
    for (const item of explorationTasks) {
      initialFindings.push(await invokeReadOnly(config.worker, promptFor('explore_agent', {
        task: String(item.question ?? item.task ?? 'Inspect the repository areas relevant to this epic and report findings.'), epic, context,
      }), repo));
    }
    const plan = jsonResponse(await invokeReadOnly(config.strong, promptFor('epic_coordinator', {
      task: 'Plan the requested epic as ordered implementation stages. Return JSON: {"summary":"...","stages":[{"id":"stable-kebab-id","title":"...","objective":"...","dependencies":[],"completion_criteria":["..."]}]}. Explore through repository inspection as needed. Do not implement. Keep criteria verifiable, order dependencies, preserve unresolved requirements as blockers.',
      epic, context, initial_exploration: initialFindings.join('\n\n'),
    }), repo));
    if (!Array.isArray(plan.stages) || plan.stages.length === 0) throw new Error('Epic Coordinator returned no stages');
    record.stages = plan.stages.map((s: any, i: number) => ({
      id: String(s.id ?? `stage-${i + 1}`), title: String(s.title ?? `Stage ${i + 1}`), objective: String(s.objective ?? s.concern ?? ''),
      dependencies: Array.isArray(s.dependencies) ? s.dependencies.map(String) : [],
      completion_criteria: Array.isArray(s.completion_criteria) ? s.completion_criteria.map(String) : [], status: 'pending', attempts: [],
    }));
    record.history.push({ type: 'plan', summary: plan.summary ?? '', stages: record.stages.length });
    record.status = 'running'; save();

    for (const stage of record.stages) {
      const incomplete = stage.dependencies.filter((dep) => !record.stages.some((item) => item.id === dep && item.status === 'complete'));
      if (incomplete.length) throw new Error(`Stage ${stage.id} has incomplete dependencies: ${incomplete.join(', ')}`);
      await runStage(repo, record, stage, config, context, save);
    }
    record.status = 'complete';
    record.history.push({ type: 'complete', at: new Date().toISOString() });
    save();
    await finalizeRecord(repo);
    return record;
  } catch (error) {
    record.status = 'failed'; record.error = error instanceof Error ? error.message : String(error); save();
    throw error;
  }
}

export async function resumeRun(repo: string, reference: string, config: StrataConfig): Promise<RecordData> {
  const candidate = path.resolve(repo, reference);
  const file = fs.existsSync(candidate) ? candidate : path.join(repo, 'docs', 'temps', `${reference.replace(/\.json$/, '')}.json`);
  if (!fs.existsSync(file)) throw new Error(`Run record not found: ${reference}`);
  const record = JSON.parse(fs.readFileSync(file, 'utf8')) as RecordData;
  if (path.resolve(record.repo) !== path.resolve(repo)) throw new Error(`Run ${record.id} belongs to another repository: ${record.repo}`);
  if (record.status === 'complete') return record;
  const save = () => { record.updated_at = new Date().toISOString(); fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`); };
  record.status = 'running'; delete record.error; save();
  try {
    const context = projectContext(repo, config);
    if (!record.stages.length) {
      const explorationPlan = jsonResponse(await invokeReadOnly(config.strong, promptFor('epic_coordinator', {
        task: 'Identify up to three focused repository exploration questions needed to plan this epic. Return JSON {"exploration_tasks":[{"question":"..."}]}. Do not implement.',
        epic: record.epic, context,
      }), repo));
      const explorationTasks: any[] = Array.isArray(explorationPlan.exploration_tasks) && explorationPlan.exploration_tasks.length
        ? explorationPlan.exploration_tasks.slice(0, 3)
        : [{ question: 'Inspect repository specifications, conventions, and implementation areas relevant to this epic.' }];
      const findings: string[] = [];
      for (const item of explorationTasks) {
        findings.push(await invokeReadOnly(config.worker, promptFor('explore_agent', {
          task: String(item.question ?? item.task ?? 'Inspect the repository areas relevant to this epic.'), epic: record.epic, context,
        }), repo));
      }
      const plan = jsonResponse(await invokeReadOnly(config.strong, promptFor('epic_coordinator', {
        task: 'Plan this epic as ordered implementation stages. Return JSON {"summary":"...","stages":[{"id":"stable-kebab-id","title":"...","objective":"...","dependencies":[],"completion_criteria":["..."]}]}. Do not implement. Keep criteria verifiable and preserve unresolved requirements as blockers.',
        epic: record.epic, context, initial_exploration: findings.join('\n\n'),
      }), repo));
      if (!Array.isArray(plan.stages) || !plan.stages.length) throw new Error('Epic Coordinator returned no stages while resuming the planning step');
      record.stages = plan.stages.map((s: any, i: number) => ({
        id: String(s.id ?? `stage-${i + 1}`), title: String(s.title ?? `Stage ${i + 1}`), objective: String(s.objective ?? s.concern ?? ''),
        dependencies: Array.isArray(s.dependencies) ? s.dependencies.map(String) : [],
        completion_criteria: Array.isArray(s.completion_criteria) ? s.completion_criteria.map(String) : [], status: 'pending', attempts: [],
      }));
      record.history.push({ type: 'plan', summary: plan.summary ?? '', stages: record.stages.length });
      save();
    }
    for (const stage of record.stages) {
      if (stage.status === 'complete') continue;
      stage.status = 'pending';
      const incomplete = stage.dependencies.filter((dep) => !record.stages.some((item) => item.id === dep && item.status === 'complete'));
      if (incomplete.length) throw new Error(`Stage ${stage.id} has incomplete dependencies: ${incomplete.join(', ')}`);
      await runStage(repo, record, stage, config, context, save);
    }
    record.status = 'complete'; record.history.push({ type: 'complete', at: new Date().toISOString() }); save();
    await finalizeRecord(repo);
    return record;
  } catch (error) {
    record.status = 'failed'; record.error = error instanceof Error ? error.message : String(error); save(); throw error;
  }
}

async function runStage(repo: string, record: RecordData, stage: Stage, config: StrataConfig, context: string, save: () => void) {
  stage.status = 'in_progress'; save();
  const contract = JSON.stringify({ stage, epic: record.epic }, null, 2);
  const explore = await invokeReadOnly(config.worker, promptFor('explore_agent', {
    task: 'Investigate relevant code, tests, conventions, dependencies, and project instructions for this stage. Read only; return JSON {"summary":"...","findings":[...],"files":[...],"uncertainties":[]}.', contract, context,
  }), repo);
  const taskPlan = jsonResponse(await invokeReadOnly(config.strong, promptFor('stage_coordinator', {
    task: 'Turn this stage into ordered, focused implementation tasks. Do not implement. Return JSON {"implementation_tasks":[{"task":"..."}],"validation_requirements":[...]}. Include testing and quality work in each appropriate implementation handoff; preserve the stage acceptance criteria.',
    contract, explore, context,
  }), repo));
  let tasks: any[] = Array.isArray(taskPlan.implementation_tasks) && taskPlan.implementation_tasks.length ? taskPlan.implementation_tasks : [{ task: stage.objective }];
  const attempts = config.workflow.implement_fix_attempts;
  let passed = false;
  let findings = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1 && findings) {
      const repairPlan = jsonResponse(await invokeReadOnly(config.strong, promptFor('stage_coordinator', {
        task: 'Review the prior implementation, tester, and validator findings. Clarify and route the required repairs as ordered implementation tasks. Do not implement. Return JSON {"implementation_tasks":[{"task":"..."}]}. Keep the original stage contract authoritative.',
        contract, findings, context,
      }), repo));
      if (Array.isArray(repairPlan.implementation_tasks) && repairPlan.implementation_tasks.length) tasks = repairPlan.implementation_tasks;
    }
    const implementations: string[] = [];
    for (let i = 0; i < tasks.length; i += 1) {
      implementations.push(await invoke(config.worker, promptFor('implementer', {
        task: `Implement task ${i + 1} of ${tasks.length}. Make code changes in scope, follow project rules and specs, and do not create reports or edit specifications. Specification changes belong to the Epic Coordinator and require explicit authorization in the epic. Return a concise summary.`,
        contract, implementation_task: tasks[i].task, previous_findings: findings, context,
      }), repo));
    }
    let checks = await runChecks(repo, config);
    const testReport = await invoke(config.worker, promptFor('tester', {
      task: 'Review the implementation, run relevant focused checks, and fix test or quality failures. Do not edit specs. Return JSON {"status":"pass|fail","findings":[...],"summary":"..."}.',
      contract, implementation: implementations.join('\n'), checks: JSON.stringify(checks), previous_findings: findings, context,
    }), repo);
    checks = await runChecks(repo, config);
    const checkFailure = checks.filter((c) => c.code !== 0).map((c) => `${c.command.join(' ')} failed (${c.code})\n${c.output}`).join('\n');
    const validation = jsonResponse(await invokeReadOnly(config.worker, promptFor('validator', {
      task: 'Read-only validation. Compare the repository against the stage criteria and applicable specs. Return JSON {"status":"pass|fail","findings":["specific evidence-backed findings"],"summary":"..."}. Do not edit files.',
      contract, implementation: implementations.join('\n'), test_report: testReport, check_failure: checkFailure, context,
    }), repo));
    const testerResult = safeJson(testReport);
    const currentFindings = [checkFailure, JSON.stringify(testerResult), JSON.stringify(validation)].filter(Boolean).join('\n');
    const thisPassed = !checkFailure && testerResult?.status === 'pass' && validation.status === 'pass';
    stage.attempts!.push({ attempt, implementations, checks, tester: testerResult ?? testReport, validation, passed: thisPassed });
    record.history.push({ type: 'stage_attempt', stage: stage.id, attempt, passed: thisPassed }); save();
    if (thisPassed) { passed = true; break; }
    findings = currentFindings;
  }
  if (!passed) throw new Error(`Stage ${stage.id} did not pass after ${attempts} implement/fix attempts. Findings are recorded in the run file.`);

  const archive = await invoke(config.worker, promptFor('archivist', {
    task: `Record durable decisions, notes, and progress under ${config.workflow.memory_path}. Keep notes factual and concise.`,
    contract, stage_results: JSON.stringify(stage.attempts), context,
  }), repo);
  record.history.push({ type: 'archive', stage: stage.id, result: archive });
  stage.status = 'complete';
  record.history.push({ type: 'stage_complete', stage: stage.id, at: new Date().toISOString() }); save();
  await checkpoint(repo, stage);
}

async function runChecks(repo: string, config: StrataConfig): Promise<any[]> {
  const checks = config.workflow.checks.length ? config.workflow.checks : discoverChecks(repo);
  const results = [];
  for (const command of checks) {
    const result = await run(command[0], command.slice(1), repo, 15 * 60 * 1000);
    results.push({ command, code: result.code, output: `${result.stdout}\n${result.stderr}`.slice(-5000) });
  }
  return results;
}

async function invokeReadOnly(agent: StrataConfig['worker'] | StrataConfig['strong'], prompt: string, repo: string): Promise<string> {
  const before = await workspaceFingerprint(repo);
  const response = await invoke(agent, prompt, repo, true);
  const after = await workspaceFingerprint(repo);
  if (before !== after) throw new Error('A read-only workflow agent changed the target worktree');
  return response;
}

async function workspaceFingerprint(repo: string): Promise<string> {
  const tracked = await run('git', ['diff', '--binary', 'HEAD'], repo, 10000);
  const untracked = await run('git', ['ls-files', '--others', '--exclude-standard', '-z'], repo, 10000);
  const hash = createHash('sha256').update(tracked.stdout).update(tracked.stderr);
  for (const file of untracked.stdout.split('\0').filter(Boolean).sort()) {
    const full = path.join(repo, file);
    try { hash.update(file).update(fs.readFileSync(full)); } catch { hash.update(`${file}:missing`); }
  }
  return hash.digest('hex');
}

function discoverChecks(repo: string): string[][] {
  const packageFile = path.join(repo, 'package.json');
  if (!fs.existsSync(packageFile)) return [];
  let scripts: Record<string, string>;
  try { scripts = JSON.parse(fs.readFileSync(packageFile, 'utf8')).scripts ?? {}; } catch { return []; }
  const manager = fs.existsSync(path.join(repo, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(repo, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(repo, 'bun.lock')) ? 'bun' : 'npm';
  const checks: string[][] = [];
  for (const name of [scripts['test:ci'] ? 'test:ci' : scripts.test ? 'test' : '', 'lint', 'typecheck', 'build'].filter(Boolean)) {
    checks.push(manager === 'npm' ? ['npm', 'run', name] : [manager, 'run', name]);
  }
  return checks;
}

async function checkpoint(repo: string, stage: Stage) {
  const status = await run('git', ['status', '--porcelain'], repo, 10000);
  if (!status.stdout.trim()) return;
  await run('git', ['add', '-A'], repo, 10000);
  const message = `strata: ${stage.title}`;
  const commit = await run('git', ['commit', '-m', message], repo, 60000);
  if (commit.code !== 0) throw new Error(`Stage checkpoint commit failed: ${commit.stderr}`);
  const push = await run('git', ['push'], repo, 120000);
  if (push.code !== 0) throw new Error(`Stage ${stage.id} committed but push failed: ${push.stderr}`);
}

async function finalizeRecord(repo: string) {
  const status = await run('git', ['status', '--porcelain'], repo, 10000);
  if (status.stdout.trim()) {
    await run('git', ['add', '-A'], repo, 10000);
    const commit = await run('git', ['commit', '-m', 'strata: record completed run'], repo, 60000);
    if (commit.code !== 0) throw new Error(`Final run checkpoint commit failed: ${commit.stderr}`);
  }
  const push = await run('git', ['push'], repo, 120000);
  if (push.code !== 0) throw new Error(`Final run push failed: ${push.stderr}`);
}

function projectContext(repo: string, config: StrataConfig): string {
  const chunks: string[] = [];
  for (const relative of config.workflow.spec_paths) {
    const target = path.resolve(repo, relative);
    if (!target.startsWith(`${repo}${path.sep}`) && target !== repo) continue;
    if (!fs.existsSync(target)) continue;
    const paths = fs.statSync(target).isDirectory()
      ? walk(target).filter((item) => item.endsWith('.md')).slice(0, 40)
      : [target];
    for (const file of paths) {
      chunks.push(`--- ${path.relative(repo, file)} ---\n${fs.readFileSync(file, 'utf8').slice(0, 16000)}`);
    }
  }
  const memory = path.resolve(repo, config.workflow.memory_path);
  if (memory.startsWith(`${repo}${path.sep}`) && fs.existsSync(memory)) {
    for (const file of walk(memory).filter((item) => item.endsWith('.md')).slice(0, 20)) {
      chunks.push(`--- ${path.relative(repo, file)} (advisory memory) ---\n${fs.readFileSync(file, 'utf8').slice(0, 8000)}`);
    }
  }
  return chunks.join('\n\n').slice(0, 80000) || '(No project specs or rules were found.)';
}

function walk(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full)); else result.push(full);
  }
  return result;
}

function promptFor(role: string, values: Record<string, string>): string {
  const roleFile = findRoleFile(role);
  const definition = roleFile ? fs.readFileSync(roleFile, 'utf8') : '';
  const coreFile = findCoreSpec();
  const core = coreFile ? fs.readFileSync(coreFile, 'utf8') : '';
  return `You are Strata's ${role.replaceAll('_', ' ')}. Follow the Strata workflow specification and this role definition.\n\n## Strata workflow\n${core}\n\n## Role definition\n${definition}\n\n${Object.entries(values).map(([key, value]) => `## ${key.replaceAll('_', ' ')}\n${value}`).join('\n\n')}`;
}

function findRoleFile(role: string): string | undefined {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    const file = path.join(directory, 'specs', 'agents', `${role.replaceAll('_', '-')}.md`);
    if (fs.existsSync(file)) return file;
    directory = path.dirname(directory);
  }
  return undefined;
}

function findCoreSpec(): string | undefined {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    const file = path.join(directory, 'specs', 'core.md');
    if (fs.existsSync(file)) return file;
    directory = path.dirname(directory);
  }
  return undefined;
}

function safeJson(text: string): any {
  try { return jsonResponse(text); } catch { return undefined; }
}
