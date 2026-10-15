import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { StrataConfig } from './config.js';
import { invoke, jsonResponse, run } from './provider.js';

type Stage = { id: string; title: string; objective: string; dependencies: string[]; completion_criteria: string[]; status?: string; attempts?: any[] };
type RecordData = { id: string; status: string; created_at: string; updated_at: string; repo: string; epic: string; epic_file: string; branch: string; stages: Stage[]; blockers?: string[]; history: any[]; error?: string };
type WorkspaceFile = { kind: 'file' | 'symlink'; contents: Buffer; mode: number };
type WorkspaceSnapshot = { files: Map<string, WorkspaceFile>; indexPath: string; index?: Buffer; fingerprint: string };

class ReadOnlyMutationError extends Error {}

async function timedStep<T>(label: string, action: () => Promise<T>): Promise<T> {
  const started = Date.now();
  console.error(`[strata] ${label}...`);
  try {
    const result = await action();
    console.error(`[strata] ${label} completed in ${formatDuration(Date.now() - started)}`);
    return result;
  } catch (error) {
    console.error(`[strata] ${label} failed after ${formatDuration(Date.now() - started)}: ${errorMessage(error)}`);
    throw error;
  }
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

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
  const record: RecordData = { id, status: 'planning', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), repo, epic, epic_file: epicFile, branch, stages: [], blockers: [], history: [] };
  const file = path.join(repo, 'docs', 'temps', `${id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const save = () => { record.updated_at = new Date().toISOString(); fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`); };
  save();
  try {
    const context = projectContext(repo, config);
    const explorationPlan = jsonResponse(await timedStep('Plan repository exploration', () => invokeReadOnly(config.strong, promptFor('epic_coordinator', {
      task: 'Identify up to three focused repository exploration questions needed to plan the epic. Do not plan stages or implement. Return JSON {"exploration_tasks":[{"question":"..."}]}.',
      epic, context,
    }), repo)));
    const explorationTasks: any[] = Array.isArray(explorationPlan.exploration_tasks) && explorationPlan.exploration_tasks.length
      ? explorationPlan.exploration_tasks.slice(0, 3)
      : [{ question: 'Inspect the repository specifications, conventions, and implementation areas relevant to this epic.' }];
    const initialFindings: string[] = [];
    for (const item of explorationTasks) {
      initialFindings.push(clip(await timedStep(`Explore epic (${initialFindings.length + 1}/${explorationTasks.length})`, () => exploreWithRecovery(config, promptFor('explore_agent', {
        task: String(item.question ?? item.task ?? 'Inspect the repository areas relevant to this epic and report findings.'), epic, context,
      }), repo)), 6000));
    }
    const plan = await timedStep('Plan implementation stages', () => planEpic(config, repo, epic, context, initialFindings.join('\n\n')));
    if (plan.blockers.length) {
      record.blockers = plan.blockers;
      record.status = 'blocked';
      record.history.push({ type: 'blocked', blockers: plan.blockers });
      save();
      return record;
    }
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
      await timedStep(`Stage ${stage.id}: ${stage.title}`, () => runStage(repo, record, stage, config, context, save));
    }
    record.status = 'complete';
    record.history.push({ type: 'complete', at: new Date().toISOString() });
    save();
    await timedStep('Finalize run checkpoint', () => finalizeRecord(repo));
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
  const wasBlocked = record.status === 'blocked';
  const save = () => { record.updated_at = new Date().toISOString(); fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`); };
  record.status = 'running'; delete record.error; save();
  try {
    const context = projectContext(repo, config);
    if (!record.stages.length || (wasBlocked && !record.stages.some((stage) => stage.status === 'complete'))) {
      record.blockers = [];
      record.stages = [];
      const explorationPlan = jsonResponse(await timedStep('Plan repository exploration', () => invokeReadOnly(config.strong, promptFor('epic_coordinator', {
        task: 'Identify up to three focused repository exploration questions needed to plan this epic. Return JSON {"exploration_tasks":[{"question":"..."}]}. Do not implement.',
        epic: record.epic, context,
      }), repo)));
      const explorationTasks: any[] = Array.isArray(explorationPlan.exploration_tasks) && explorationPlan.exploration_tasks.length
        ? explorationPlan.exploration_tasks.slice(0, 3)
        : [{ question: 'Inspect repository specifications, conventions, and implementation areas relevant to this epic.' }];
      const findings: string[] = [];
      for (const item of explorationTasks) {
        findings.push(clip(await timedStep(`Explore epic (${findings.length + 1}/${explorationTasks.length})`, () => exploreWithRecovery(config, promptFor('explore_agent', {
          task: String(item.question ?? item.task ?? 'Inspect the repository areas relevant to this epic.'), epic: record.epic, context,
        }), repo)), 6000));
      }
      const plan = await timedStep('Plan implementation stages', () => planEpic(config, repo, record.epic, context, findings.join('\n\n')));
      if (plan.blockers.length) {
        record.blockers = plan.blockers;
        record.status = 'blocked';
        record.history.push({ type: 'blocked', blockers: plan.blockers });
        save();
        return record;
      }
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
      const incomplete = stage.dependencies.filter((dep) => !record.stages.some((item) => item.id === dep && item.status === 'complete'));
      if (incomplete.length) throw new Error(`Stage ${stage.id} has incomplete dependencies: ${incomplete.join(', ')}`);
      if (stage.status === 'checkpoint_pending') {
        await timedStep(`Checkpoint stage ${stage.id}`, () => completeStage(repo, record, stage, save));
        continue;
      }
      stage.status = 'pending';
      await timedStep(`Stage ${stage.id}: ${stage.title}`, () => runStage(repo, record, stage, config, context, save));
    }
    record.status = 'complete'; record.history.push({ type: 'complete', at: new Date().toISOString() }); save();
    await timedStep('Finalize run checkpoint', () => finalizeRecord(repo));
    return record;
  } catch (error) {
    record.status = 'failed'; record.error = error instanceof Error ? error.message : String(error); save(); throw error;
  }
}

async function planEpic(config: StrataConfig, repo: string, epic: string, context: string, initialExploration: string) {
  const plan = jsonResponse(await invokeReadOnly(config.strong, promptFor('epic_coordinator', {
    task: 'Plan the explicitly requested epic as ordered implementation stages. Return JSON: {"summary":"...","blockers":["..."],"stages":[{"id":"stable-kebab-id","title":"...","objective":"...","dependencies":[],"completion_criteria":["..."]}]}. Use an empty blockers array when implementation can proceed. Do not implement. Keep criteria verifiable and order dependencies. Size stages for the configured Implementer, whose practical capacity may be lower than yours: each stage should usually cover one subsystem or responsibility and be completable in no more than three focused implementation handoffs. Split broad refactors across dependent stages at responsibility seams; do not combine independent modules or unrelated test restructuring just because they share a global criterion. Keep intermediate stages coherent and verifiable, and put criteria that can only be met after all migrations in a final integration stage. Treat features explicitly requested by the epic as authorized work; absence from an MVP included-features list is not itself a conflict, and a private user-initiated export is not public sharing. Preserve existing privacy and data constraints while planning the requested feature. Do not require a specification edit unless the epic explicitly asks to change specifications. If a genuine unresolved decision prevents safe implementation, return it in blockers and do not create a stage whose purpose is to resolve that blocker or edit specs. Do not invent unavailable data sources; when requested metadata such as location is not captured or persisted, plan to omit it unless the epic explicitly authorizes collecting it.',
    epic, context, initial_exploration: initialExploration,
  }), repo));
  return {
    ...plan,
    blockers: Array.isArray(plan.blockers) ? plan.blockers.map(String).filter(Boolean) : [],
  };
}

async function runStage(repo: string, record: RecordData, stage: Stage, config: StrataConfig, context: string, save: () => void) {
  stage.status = 'in_progress'; save();
  // A persisted stage also contains every attempt, including tool transcripts in
  // agent responses. Never put that history back into the prompt contract.
  const contract = JSON.stringify({
    stage: {
      id: stage.id,
      title: stage.title,
      objective: stage.objective,
      dependencies: stage.dependencies,
      completion_criteria: stage.completion_criteria,
    },
    epic: record.epic,
  }, null, 2);
  const stageContext = `${clip(relevantSourceContext(repo, stage), 8000)}\n\n${clip(context, 5000)}`;
  const lastAttempt = stage.attempts?.at(-1);
  let findings = lastAttempt && !lastAttempt.passed ? clip(attemptFindings(lastAttempt), 6000) : '';
  const explore = clip(await timedStep(`Stage ${stage.id}: explore`, () => exploreWithRecovery(config, promptFor('explore_agent', {
    task: 'Investigate relevant code, tests, conventions, dependencies, and project instructions for this stage. Read the stage-specific source excerpts and verify them against the repository. Read only; return JSON {"summary":"...","findings":[...],"files":[...],"uncertainties":[]}.', contract, context: stageContext,
  }), repo)), 7000);
  const taskPlan = jsonResponse(await timedStep(`Stage ${stage.id}: plan tasks`, () => invokeReadOnly(config.strong, promptFor('stage_coordinator', {
    task: 'Turn this stage into ordered, small implementation tasks. Do not implement. Return JSON {"implementation_tasks":[{"id":"stable-id","task":"...","files":["path/to/file"],"depends_on":[],"validation_criteria":["..."]}],"validation_requirements":[...]}. Keep each task feasible in one handoff and focused on one function or one cohesive responsibility. For large refactors, assign one function per task and give each task a distinct destination file; defer shared exports and integration to a final task. Mark exact files each task may edit. Independent tasks with non-overlapping files and no dependencies will run in parallel, so do not mark tasks independent when they share files or depend on another task. Include a concrete focused check and validation criteria for each task. Do not bundle unrelated modules or repository-wide validation. If the stage is too broad to split safely into small tasks, recommend dependent stages. When prior findings are present, address them directly and do not repeat rejected approaches.',
    contract, explore, prior_attempt_findings: findings, context: stageContext,
  }), repo)));
  let tasks: any[] = Array.isArray(taskPlan.implementation_tasks) && taskPlan.implementation_tasks.length ? taskPlan.implementation_tasks : [{ task: stage.objective }];
  const attempts = config.workflow.implement_fix_attempts;
  let passed = false;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1 && findings) {
      try {
        const repairPlan = jsonResponse(await timedStep(`Stage ${stage.id}: plan repairs`, () => invokeReadOnly(config.strong, promptFor('stage_coordinator', {
          task: 'Review the prior implementation, tester, and validator findings. Clarify and route required repairs as ordered, small tasks. Do not implement. Return JSON {"implementation_tasks":[{"id":"stable-id","task":"...","files":["path/to/file"],"depends_on":[],"validation_criteria":["..."]}]}. Keep the original stage contract authoritative. Focus each task on one function or one cohesive responsibility, name exact files, and include a concrete focused check and validation criteria. Independent tasks with non-overlapping files and no dependencies may run in parallel. Do not repeat a failed broad handoff; if the repair is too broad, recommend dependent stage boundaries.',
          contract, findings, previous_implementation_tasks: JSON.stringify(tasks), context: stageContext,
        }), repo)));
        if (Array.isArray(repairPlan.implementation_tasks) && repairPlan.implementation_tasks.length) tasks = repairPlan.implementation_tasks;
      } catch (error) {
        findings += `\nStage Coordinator repair planning failed; retrying the previous implementation tasks. ${errorMessage(error)}`;
      }
    }
    const implementations: string[] = Array(tasks.length);
    const implementationFailures: string[] = [];
    const outcomes: Array<{ response: string; failure?: string }> = Array(tasks.length);
    for (const batch of taskBatches(tasks)) {
      const prior = outcomes.filter(Boolean).map((result) => result.response);
      const results = await Promise.all(batch.map((index) => implementTask(tasks[index], index, tasks, prior, findings, stageContext, explore, contract, config, repo, stage.id)));
      batch.forEach((index, offset) => { outcomes[index] = results[offset]; implementations[index] = results[offset].response; });
    }
    implementationFailures.push(...outcomes.flatMap((result) => result.failure ? [result.failure] : []));
    let checks = await timedStep(`Stage ${stage.id}: checks (attempt ${attempt})`, () => runChecks(repo, config));
    // Agent output may contain long tool transcripts. Reviewers need a concise
    // handoff, not those transcripts repeated alongside the source context.
    const implementationReview = implementations.map((item, index) => `Task ${index + 1}: ${item.slice(-800)}`).join('\n\n');
    const checkReview = checks.map((check) => ({
      command: check.command.join(' '),
      passed: check.code === 0,
      ...(check.code !== 0 && check.output ? { output: clip(check.output, 3000) } : {}),
    }));
    const reviewContext = clip(stageContext, 2000);
    let testReport: string;
    const testerPrompt = promptFor('tester', {
      task: 'Review the implementation and automated check results already provided. Do not rerun the configured full check suite; Strata runs it automatically before and after this review. Run only a narrowly focused check if needed to diagnose a specific failure, and fix failures introduced by this implementation. Do not edit specs. Your entire response must be exactly one JSON object with shape {"status":"pass|fail","findings":[...],"summary":"..."}; no markdown, code fences, or surrounding prose. If uncertain, use status "fail".',
        contract, task_plan: JSON.stringify(tasks), implementation: implementationReview, checks: JSON.stringify(checkReview), previous_findings: clip(findings, 800), context: reviewContext,
    });
    try {
      testReport = clip(await timedStep(`Stage ${stage.id}: tester review (attempt ${attempt})`, () => invoke(config.worker, testerPrompt, repo)), 6000);
    } catch (error) {
      const workerAndStrongMatch = config.worker.provider === config.strong.provider && config.worker.model === config.strong.model;
      if (workerAndStrongMatch) {
        testReport = JSON.stringify({ status: 'fail', findings: [`Tester process failed: ${errorMessage(error)}`], summary: 'Tester did not complete.' });
      } else {
        console.error(`[strata] recovering failed tester with ${config.strong.provider}${config.strong.model ? ` / ${config.strong.model}` : ''}`);
        try {
          testReport = clip(await timedStep(`Stage ${stage.id}: recover tester review`, () => invoke(config.strong, `${testerPrompt}\n\n## Recovery handoff\nThe configured tester process failed before reviewing this implementation: ${errorMessage(error)}\nReview the supplied results and complete the requested testing review.`, repo)), 6000);
        } catch (recoveryError) {
          testReport = JSON.stringify({ status: 'fail', findings: [`Tester process failed: ${errorMessage(error)}`, `Strong-agent recovery failed: ${errorMessage(recoveryError)}`], summary: 'Tester did not complete.' });
        }
      }
    }
    let testerResult = safeStatusResponse(testReport);
    if (shouldRecoverReview(testerResult) && !sameAgent(config.worker, config.strong)) {
      console.error(`[strata] recovering inconclusive tester review with ${config.strong.provider}${config.strong.model ? ` / ${config.strong.model}` : ''}`);
      try {
        const recovery = await timedStep(`Stage ${stage.id}: recover inconclusive tester review`, () => invoke(config.strong, promptFor('tester', {
          task: 'Independently review the supplied stage criteria, implementation summary, and completed automated checks. The first tester response was malformed or inconclusive. Do not assume warnings mean failure when every check exited successfully. Identify only concrete, evidence-backed mismatches; return exactly one JSON object with status, findings, and summary. Do not edit specs.',
          contract, implementation: implementationReview, checks: JSON.stringify(checkReview), previous_findings: clip(findings, 800), initial_tester_response: clip(testReport, 1500), context: reviewContext,
        }), repo));
        const recovered = safeStatusResponse(recovery);
        if (!shouldRecoverReview(recovered)) {
          testerResult = recovered;
          testReport = JSON.stringify(recovered);
        }
      } catch (error) {
        testReport = `${testReport}\nStrong-agent review recovery failed: ${errorMessage(error)}`;
        testerResult = safeStatusResponse(testReport);
      }
    }
    checks = await timedStep(`Stage ${stage.id}: final checks (attempt ${attempt})`, () => runChecks(repo, config));
    const checkFailure = checks.filter((c) => c.code !== 0).map((c) => `${c.command.join(' ')} failed (${c.code})\n${c.output}`).join('\n');
    let validation: any;
    try {
      const validationResults = [];
      for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index];
        const scope = {
          id: task.id ?? String(index + 1), task: task.task ?? task,
          files: task.files ?? [], criteria: task.validation_criteria ?? stage.completion_criteria,
        };
        const validatorPrompt = promptFor('validator', {
          task: 'Read-only validation of this task only. Check its assigned criteria and files against current code and applicable specifications. Do not review unrelated tasks. Re-read current files before reporting a defect; do not repeat earlier findings unless they still reproduce. Treat latest_checks as authoritative and cite exact current evidence for every finding. Return exactly one JSON object with status, findings, and summary. Do not edit files.',
          contract, validation_scope: JSON.stringify(scope), implementation: implementations[index],
          test_report: clip(testReport, 1200), latest_checks: JSON.stringify(checks.map((check) => ({
            command: check.command.join(' '), exit_code: check.code,
            ...(check.code !== 0 && check.output ? { failure_output: clip(check.output, 1800) } : {}),
          }))), context: reviewContext,
        });
        const result = statusResponse(await timedStep(`Stage ${stage.id}: validate task ${index + 1}/${tasks.length}`, () => invokeReadOnly(config.worker, validatorPrompt, repo)));
        validationResults.push({ ...result, findings: (result.findings ?? []).map((finding: string) => `Task ${scope.id}: ${finding}`) });
      }
      validation = {
        status: validationResults.every((result) => result.status === 'pass') ? 'pass' : 'fail',
        findings: validationResults.flatMap((result) => result.findings),
        summary: `${validationResults.filter((result) => result.status === 'pass').length}/${validationResults.length} task validations passed.`,
      };
    } catch (error) {
      const message = error instanceof ReadOnlyMutationError ? error.message : `Validator process failed: ${errorMessage(error)}`;
      validation = { status: 'fail', findings: [message], summary: 'Validation did not complete successfully.' };
    }
    const implementationSummary = implementations.map((item, index) => `Task ${index + 1}: ${item.slice(-1800)}`).join('\n');
    const currentFindings = [implementationSummary, ...implementationFailures, checkFailure, JSON.stringify(testerResult), JSON.stringify(validation)].filter(Boolean).join('\n');
    const thisPassed = implementationFailures.length === 0 && !checkFailure && testerResult?.status === 'pass' && validation.status === 'pass';
    stage.attempts!.push({ attempt, implementations, implementation_failures: implementationFailures, checks, tester: testerResult ?? testReport, validation, passed: thisPassed });
    record.history.push({ type: 'stage_attempt', stage: stage.id, attempt, passed: thisPassed }); save();
    if (thisPassed) { passed = true; break; }
    findings = currentFindings;
  }
  if (!passed) throw new Error(`Stage ${stage.id} did not pass after ${attempts} implement/fix attempts. Findings are recorded in the run file.`);

  const archive = await timedStep(`Stage ${stage.id}: archive`, () => invoke(config.worker, promptFor('archivist', {
    task: `Record durable decisions, notes, and progress under ${config.workflow.memory_path}. Keep notes factual and concise.`,
    contract, stage_results: clip(JSON.stringify(stage.attempts!.map((item) => ({
      attempt: item.attempt,
      passed: item.passed,
      checks: item.checks?.map((check: any) => ({ command: check.command, code: check.code })),
      tester: item.tester && { status: item.tester.status, summary: item.tester.summary, findings: item.tester.findings },
      validation: item.validation && { status: item.validation.status, summary: item.validation.summary, findings: item.validation.findings },
    }))), 12000), context: clip(context, 6000),
  }), repo));
  record.history.push({ type: 'archive', stage: stage.id, result: clip(archive, 4000) });
  stage.status = 'checkpoint_pending'; save();
  await timedStep(`Checkpoint stage ${stage.id}`, () => completeStage(repo, record, stage, save));
}

function taskBatches(tasks: any[]): number[][] {
  const ids = new Map(tasks.map((task, index) => [String(task.id ?? index + 1), index]));
  const dependencies: Array<Array<number | undefined>> = tasks.map((task: any) => (Array.isArray(task.depends_on) ? task.depends_on : []).map((id: unknown) => ids.get(String(id))));
  if (dependencies.some((items: Array<number | undefined>) => items.some((index: number | undefined) => index === undefined))) {
    return tasks.map((_, index) => [index]);
  }
  const pending = new Set(tasks.map((_, index) => index));
  const complete = new Set<number>();
  const batches: number[][] = [];
  while (pending.size) {
    const ready = [...pending].filter((index: number) => dependencies[index].every((dependency: number | undefined) => dependency !== undefined && complete.has(dependency)));
    if (!ready.length) return tasks.map((_, index) => [index]);
    const batch: number[] = [];
    const claimedFiles = new Set<string>();
    for (const index of ready) {
      const files = Array.isArray(tasks[index].files) ? tasks[index].files.map(String) : [];
      if (!files.length || files.some((file: string) => claimedFiles.has(file))) continue;
      batch.push(index);
      files.forEach((file: string) => claimedFiles.add(file));
    }
    if (!batch.length) batch.push(ready[0]);
    batches.push(batch);
    batch.forEach((index) => { pending.delete(index); complete.add(index); });
  }
  return batches;
}

async function implementTask(task: any, index: number, tasks: any[], previous: string[], findings: string, context: string, explore: string, contract: string, config: StrataConfig, repo: string, stageId: string): Promise<{ response: string; failure?: string }> {
  const taskText = typeof task === 'string' ? task : String(task.task ?? '');
  const implementationPrompt = promptFor('implementer', {
    task: `Implement task ${index + 1} of ${tasks.length}. Edit only the files listed in task_scope. Inspect and build on the current worktree and supplied exploration. Complete the scoped changes; do not stop at a plan or claim. Return a concise summary of actual changes.`,
    contract, implementation_task: taskText, task_scope: JSON.stringify({ files: task.files ?? [], depends_on: task.depends_on ?? [], validation_criteria: task.validation_criteria ?? [] }),
    task_plan: JSON.stringify(tasks), stage_exploration: explore,
    prior_task_results: clip(previous.join('\n\n'), 2500), previous_findings: clip(findings, 4000), context: clip(context, 6000),
  });
  try {
    const response = await timedStep(`Stage ${stageId}: implement task ${index + 1}/${tasks.length}`, () => invoke(config.worker, implementationPrompt, repo));
    if (!sameAgent(config.worker, config.strong)) {
      const refusal = implementationRefusal(response);
      if (refusal) return { response: clip(response, 4000), failure: `Worker did not implement task ${index + 1}: ${refusal}` };
    }
    return { response: clip(response, 4000) };
  } catch (error) {
    const failure = `Implementer task ${index + 1} failed on ${config.worker.provider}: ${errorMessage(error)}`;
    if (sameAgent(config.worker, config.strong)) return { response: failure, failure };
    console.error(`[strata] recovering failed implementer task ${index + 1} with ${config.strong.provider}${config.strong.model ? ` / ${config.strong.model}` : ''}`);
    try {
      const recovery = await timedStep(`Stage ${stageId}: recover task ${index + 1}`, () => invoke(config.strong, `${implementationPrompt}\n\n## Recovery handoff\nThe configured worker failed before completing this task: ${errorMessage(error)}\nMake only the scoped changes, then summarize them.`, repo));
      return { response: clip(recovery, 4000) };
    } catch (recoveryError) {
      const combined = `${failure}\nStrong-agent recovery also failed: ${errorMessage(recoveryError)}`;
      return { response: combined, failure: combined };
    }
  }
}

async function completeStage(repo: string, record: RecordData, stage: Stage, save: () => void) {
  await checkpoint(repo, stage);
  stage.status = 'complete';
  record.history.push({ type: 'stage_complete', stage: stage.id, at: new Date().toISOString() }); save();
}

function attemptFindings(attempt: any): string {
  const sections: string[] = [];
  for (const failure of attempt.implementation_failures ?? []) sections.push(`Implementer failure: ${String(failure)}`);
  for (const check of attempt.checks ?? []) {
    if (check.code !== 0) sections.push(`Check failed: ${(check.command ?? []).join(' ')}\n${String(check.output ?? '').slice(-3000)}`);
  }
  for (const role of ['tester', 'validation']) {
    const result = attempt[role];
    if (!result || result.status === 'pass') continue;
    const findings = Array.isArray(result.findings) ? result.findings.map(String).join('\n- ') : '';
    sections.push(`${role} findings: ${findings || result.summary || JSON.stringify(result)}`);
  }
  if (!sections.length) sections.push('The previous implementation attempt did not pass. Inspect the saved attempt and verify the stage criteria against the current worktree.');
  return sections.join('\n\n').slice(-12000);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(-2000);
}

async function runChecks(repo: string, config: StrataConfig): Promise<any[]> {
  const checks = config.workflow.checks.length ? config.workflow.checks : discoverChecks(repo);
  const results = [];
  for (let index = 0; index < checks.length; index += 1) {
    const command = checks[index];
    const label = `Check ${index + 1}/${checks.length}: ${command.join(' ')}`;
    const result = await timedStep(label, () => run(command[0], command.slice(1), repo, 15 * 60 * 1000));
    if (result.code !== 0) console.error(`[strata] ${label} failed (exit ${result.code ?? 'unknown'})`);
    results.push({ command, code: result.code, output: `${result.stdout}\n${result.stderr}`.slice(-5000) });
  }
  return results;
}

async function exploreWithRecovery(config: StrataConfig, prompt: string, repo: string): Promise<string> {
  try {
    return await invokeReadOnly(config.worker, prompt, repo);
  } catch (error) {
    if (error instanceof ReadOnlyMutationError || sameAgent(config.worker, config.strong)) throw error;
    console.error(`[strata] recovering failed explore agent with ${config.strong.provider}${config.strong.model ? ` / ${config.strong.model}` : ''}: ${errorMessage(error)}`);
    try {
      return await invokeReadOnly(config.strong, `${prompt}\n\n## Recovery handoff\nThe configured explorer failed: ${errorMessage(error)}\nInspect the repository read-only and complete the original exploration question.`, repo);
    } catch (recoveryError) {
      throw new Error(`Explore agent failed: ${errorMessage(error)}\nStrong-agent exploration recovery failed: ${errorMessage(recoveryError)}`);
    }
  }
}

async function invokeReadOnly(agent: StrataConfig['worker'] | StrataConfig['strong'], prompt: string, repo: string): Promise<string> {
  const before = await snapshotWorkspace(repo);
  let response = '';
  let failure: unknown;
  let rejected = false;
  try {
    response = await invoke(agent, prompt, repo, true);
  } catch (error) {
    rejected = true;
    failure = error;
  }
  const after = await snapshotWorkspace(repo);
  if (before.fingerprint !== after.fingerprint) {
    await restoreWorkspace(repo, before, after);
    throw new ReadOnlyMutationError('A read-only workflow agent changed the target worktree; its changes were reverted.');
  }
  if (rejected) throw failure;
  return response;
}

async function snapshotWorkspace(repo: string): Promise<WorkspaceSnapshot> {
  const listed = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], repo, 10000);
  const files = new Map<string, WorkspaceFile>();
  for (const relative of listed.stdout.split('\0').filter(Boolean)) {
    const full = path.join(repo, relative);
    try {
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) files.set(relative, { kind: 'symlink', contents: Buffer.from(fs.readlinkSync(full)), mode: stat.mode & 0o777 });
      else if (stat.isFile()) files.set(relative, { kind: 'file', contents: fs.readFileSync(full), mode: stat.mode & 0o777 });
    } catch { /* ignore files disappearing during enumeration */ }
  }
  const indexPathResult = await run('git', ['rev-parse', '--git-path', 'index'], repo, 10000);
  const indexPath = path.resolve(repo, indexPathResult.stdout.trim());
  let index: Buffer | undefined;
  try { index = fs.readFileSync(indexPath); } catch { /* a repository may not have an index yet */ }
  return { files, indexPath, index, fingerprint: fingerprintWorkspace(files, index) };
}

function fingerprintWorkspace(files: Map<string, WorkspaceFile>, index?: Buffer): string {
  const hash = createHash('sha256');
  for (const [file, state] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(file).update(state.kind).update(String(state.mode)).update(state.contents);
  }
  if (index) hash.update(index);
  return hash.digest('hex');
}

async function restoreWorkspace(repo: string, before: WorkspaceSnapshot, after: WorkspaceSnapshot): Promise<void> {
  for (const relative of after.files.keys()) {
    if (before.files.has(relative)) continue;
    const full = path.join(repo, relative);
    try { fs.unlinkSync(full); } catch { /* already removed */ }
  }
  for (const [relative, state] of before.files) {
    const full = path.join(repo, relative);
    const current = after.files.get(relative);
    if (current && current.kind === state.kind && current.mode === state.mode && current.contents.equals(state.contents)) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    try { fs.rmSync(full, { force: true }); } catch { /* recreate below */ }
    if (state.kind === 'symlink') fs.symlinkSync(state.contents.toString(), full);
    else {
      fs.writeFileSync(full, state.contents);
      fs.chmodSync(full, state.mode);
    }
  }
  if (before.index) {
    fs.mkdirSync(path.dirname(before.indexPath), { recursive: true });
    fs.writeFileSync(before.indexPath, before.index);
  } else if (after.index) {
    try { fs.unlinkSync(before.indexPath); } catch { /* index already absent */ }
  }
}

function discoverChecks(repo: string): string[][] {
  const packageFile = path.join(repo, 'package.json');
  if (!fs.existsSync(packageFile)) return [];
  let scripts: Record<string, string>;
  try { scripts = JSON.parse(fs.readFileSync(packageFile, 'utf8'))?.scripts ?? {}; } catch { return []; }
  const manager = fs.existsSync(path.join(repo, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(repo, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(repo, 'bun.lock')) ? 'bun' : 'npm';
  const checks: string[][] = [];
  const names = [scripts['test:ci'] ? 'test:ci' : scripts.test ? 'test' : '', 'lint', 'typecheck', 'build'].filter((name) => name && scripts[name]);
  for (const name of names) {
    checks.push(manager === 'npm' ? ['npm', 'run', name] : [manager, 'run', name]);
  }
  return checks;
}

async function checkpoint(repo: string, stage: Stage) {
  const status = await run('git', ['status', '--porcelain'], repo, 10000);
  if (status.stdout.trim()) {
    const added = await run('git', ['add', '-A'], repo, 10000);
    if (added.code !== 0) throw new Error(`Stage checkpoint add failed: ${added.stderr}`);
    const message = `strata: ${stage.title}`;
    const commit = await run('git', ['commit', '-m', message], repo, 60000);
    if (commit.code !== 0) throw new Error(`Stage checkpoint commit failed: ${commit.stderr}`);
  }
  const push = await pushCurrentBranch(repo);
  if (push.code !== 0) throw new Error(`Stage ${stage.id} committed but push failed: ${push.stderr}`);
}

async function finalizeRecord(repo: string) {
  const status = await run('git', ['status', '--porcelain'], repo, 10000);
  if (status.stdout.trim()) {
    await run('git', ['add', '-A'], repo, 10000);
    const commit = await run('git', ['commit', '-m', 'strata: record completed run'], repo, 60000);
    if (commit.code !== 0) throw new Error(`Final run checkpoint commit failed: ${commit.stderr}`);
  }
  const push = await pushCurrentBranch(repo);
  if (push.code !== 0) throw new Error(`Final run push failed: ${push.stderr}`);
}

async function pushCurrentBranch(repo: string) {
  const upstream = await run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repo, 10000);
  if (upstream.code === 0 && upstream.stdout.trim()) return run('git', ['push'], repo, 120000);

  const branchResult = await run('git', ['branch', '--show-current'], repo, 10000);
  const branch = branchResult.stdout.trim();
  if (!branch) return { code: 1, stdout: '', stderr: 'Cannot push because the current branch has no name.', timedOut: false };

  const configuredRemote = await run('git', ['config', '--get', `branch.${branch}.pushRemote`], repo, 10000);
  const defaultRemote = configuredRemote.code === 0
    ? configuredRemote.stdout.trim()
    : (await run('git', ['config', '--get', 'remote.pushDefault'], repo, 10000)).stdout.trim();
  const remotes = await run('git', ['remote'], repo, 10000);
  const availableRemotes = remotes.stdout.split('\n').map((remote) => remote.trim()).filter(Boolean);
  const remote = defaultRemote || (availableRemotes.includes('origin') ? 'origin' : availableRemotes[0]);
  if (!remote) return { code: 1, stdout: '', stderr: 'Cannot push because this repository has no configured remote.', timedOut: false };
  return run('git', ['push', '--set-upstream', remote, branch], repo, 120000);
}

function relevantSourceContext(repo: string, stage: Stage): string {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8' });
  if (listed.status !== 0) return '--- Stage source excerpts ---\nUnable to list repository files.';
  const stopWords = new Set(['about', 'action', 'after', 'also', 'and', 'available', 'based', 'completion', 'criteria', 'current', 'from', 'into', 'must', 'only', 'repository', 'stage', 'that', 'their', 'this', 'through', 'users', 'using', 'when', 'with']);
  const terms = [...new Set(`${stage.id} ${stage.title} ${stage.objective} ${stage.completion_criteria.join(' ')}`
    .toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? [])].filter((term) => !stopWords.has(term));
  const sourcePaths = listed.stdout.split('\n').filter((file) => /\.(?:[cm]?[jt]sx?|swift|kt|java|py|go|rs)$/.test(file)
    && /^(?:app|apps|src|source|lib|test|tests|packages)\//.test(file));
  const ranked = sourcePaths.map((file) => {
    const normalized = file.toLowerCase();
    const score = terms.reduce((total, term) => total + (normalized.includes(term) ? (path.basename(normalized).includes(term) ? 3 : 1) : 0), 0);
    return { file, score };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));
  const excerpts: string[] = [];
  let remaining = 10000;
  for (const { file } of ranked.slice(0, 8)) {
    if (remaining <= 0) break;
    try {
      const content = fs.readFileSync(path.join(repo, file), 'utf8');
      const excerpt = content.slice(0, Math.min(6000, remaining));
      excerpts.push(`--- ${file}${content.length > excerpt.length ? ' (truncated)' : ''} ---\n${excerpt}`);
      remaining -= excerpt.length;
    } catch { /* A file may disappear while the run is active. */ }
  }
  return excerpts.length
    ? `--- Stage source excerpts (current repository contents; verify against these before reporting missing files) ---\n${excerpts.join('\n\n')}`
    : '--- Stage source excerpts ---\nNo matching source files were found in the repository file index.';
}

function projectContext(repo: string, config: StrataConfig): string {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8' });
  const sourcePaths = listed.status === 0
    ? listed.stdout.split('\n').filter((file) => /\.(?:[cm]?[jt]sx?|swift|kt|java|py|go|rs)$/.test(file)
      && /^(?:app|apps|src|source|lib|test|tests|packages)\//.test(file))
    : [];
  const fileIndex = sourcePaths.slice(0, 500);
  const chunks: string[] = fileIndex.length
    ? [`--- Repository source file index (existing paths; first ${fileIndex.length} of ${sourcePaths.length}) ---\n${fileIndex.join('\n')}`]
    : [];
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
  return chunks.join('\n\n').slice(0, 12000) || '(No project specs or rules were found.)';
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
  // Coordinators need the full orchestration contract to plan work across
  // stages. Operational agents get the invariants that apply to every role;
  // their role definition and handoff already carry the task-specific rules.
  const planningRoles = new Set(['epic_coordinator', 'stage_coordinator']);
  const core = planningRoles.has(role) && coreFile
    ? fs.readFileSync(coreFile, 'utf8')
    : 'The target repository and user epic are authoritative. Follow your role boundaries and the supplied task contract; do not invent requirements. Explore Agents and Validators are read-only. A stage passes only when its criteria, applicable checks, and validation are satisfied or an authorized blocker is recorded.';
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

function statusResponse(text: string): any {
  try {
    const parsed = jsonResponse(text);
    if (parsed && ['pass', 'fail'].includes(String(parsed.status).toLowerCase())) {
      return {
        ...parsed,
        status: String(parsed.status).toLowerCase(),
        findings: Array.isArray(parsed.findings) ? parsed.findings.map(findingText) : [],
        summary: String(parsed.summary ?? ''),
      };
    }
  } catch { /* accept clearly labeled status reports */ }
  const labels = [...text.matchAll(/\*{0,2}(status|findings|summary)\s*:?\s*\*{0,2}\s*:?\s*/ig)];
  const values = new Map<string, string>();
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    const start = (label.index ?? 0) + label[0].length;
    const end = labels[index + 1]?.index ?? text.length;
    values.set(label[1].toLowerCase(), text.slice(start, end).trim().replace(/\s*\*\s*$/, '').trim());
  }
  const status = values.get('status')?.match(/^(pass|fail)\b/i)?.[1]?.toLowerCase();
  if (!status) {
    const excerpt = text.trim().slice(0, 800);
    return {
      status: 'fail',
      findings: [`Agent response did not contain JSON or a labeled pass/fail status. Response: ${excerpt}`],
      summary: 'The agent response format was invalid, so this result cannot pass validation.',
    };
  }
  const labeledFindings = values.get('findings') ?? '';
  const findings = /^(none|no findings|no mismatches detected\.?|n\/a)$/i.test(labeledFindings)
    ? []
    : labeledFindings.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  return { status, findings, summary: values.get('summary') ?? '' };
}

function findingText(finding: unknown): string {
  if (typeof finding === 'string') return finding;
  try { return JSON.stringify(finding) ?? String(finding); }
  catch { return String(finding); }
}

function implementationRefusal(text: string): string | undefined {
  const patterns = [
    /\b(?:i|we) (?:could not|couldn't|cannot|can't|am unable to|are unable to) (?:complete|implement|make|perform|carry out|finish)\b/i,
    /\b(?:unable|not able) to (?:complete|implement|make|perform|carry out|finish) (?:the |this |that |requested )?(?:task|change|refactor|implementation|work)?\b/i,
    /\b(?:i|we) (?:can(?:not|'t)|cannot|don't have permission to|do not have permission to) (?:edit|modify|change|write|update|access)\b/i,
    /\b(?:the environment|this environment|the tooling|this tooling) (?:does not|doesn't) (?:provide|expose|allow) (?:a |direct )?(?:file[- ]edit|edit|write)\b/i,
    /\bplease (?:apply|make) (?:the |these |those )?(?:changes|edits|patch(?:es)?)\b/i,
    /\bif you(?:'d| would) like me to (?:apply|make|implement) (?:the |these |those )?(?:changes|edits)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return undefined;
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const headLength = Math.ceil(maxLength * 0.75);
  const tailLength = maxLength - headLength;
  return `${value.slice(0, headLength)}\n… [${value.length - maxLength} characters omitted] …\n${value.slice(-tailLength)}`;
}

function safeStatusResponse(text: string): any {
  return statusResponse(text);
}

function shouldRecoverReview(result: any): boolean {
  const summary = String(result?.summary ?? '');
  const findings = Array.isArray(result?.findings) ? result.findings.join('\n') : '';
  const evidence = `${summary}\n${findings}`;
  return summary.includes('response format was invalid')
    || (result?.status === 'fail' && /unable to determine|unable to assess|cannot determine|can't determine|further investigation required|not enough information|not wrapped in act|act warning/i.test(evidence));
}

function sameAgent(left: StrataConfig['worker'], right: StrataConfig['strong']): boolean {
  return left.provider === right.provider && left.model === right.model && left.command === right.command;
}
