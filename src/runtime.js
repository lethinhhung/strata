import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { invoke } from './providers.js';

export class RunError extends Error {}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const runId = () => `${now().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${randomUUID().slice(0, 8)}`;
const recordPath = (repo, id) => path.join(repo, 'docs', 'temps', `${id}.md`);

function git(repo, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw new RunError(`Could not run git: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) throw new RunError((result.stderr || `git ${args.join(' ')} failed`).trim());
  return result;
}

function snapshot(repo, excludedPaths = []) {
  const excluded = new Set(excludedPaths.map((item) => path.resolve(item)));
  const output = git(repo, ['status', '--porcelain=v1', '-z']).stdout;
  const rows = output.split('\0');
  const files = new Map();
  for (let i = 0; i < rows.length && rows[i]; i += 1) {
    const row = rows[i];
    const file = row.slice(3);
    if (excluded.has(path.resolve(repo, file))) continue;
    if (file.startsWith(`docs${path.sep}temps${path.sep}`) && fs.existsSync(path.resolve(repo, file))) {
      try {
        if (fs.readFileSync(path.resolve(repo, file), 'utf8').startsWith('# Strata run ')) continue;
      } catch { /* Keep unreadable paths visible as worktree changes. */ }
    }
    files.set(file, row.slice(0, 2));
    if (row[0] === 'R' || row[1] === 'R' || row[0] === 'C' || row[1] === 'C') i += 1;
  }
  return files;
}

function runSnapshot(repo, record, file) {
  return snapshot(repo, [file, record.config, record.epic_absolute_path]);
}

function changes(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((file) => before.get(file) !== after.get(file)).sort();
}

const generatedDirectories = new Set(['.git', 'node_modules', '.expo', '.turbo', 'Pods', '.gradle', 'coverage']);

function copyWorkspace(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter(item) {
      const relative = path.relative(source, item);
      if (!relative) return true;
      if (relative.split(path.sep).some((part) => generatedDirectories.has(part))) return false;
      try { return !fs.lstatSync(item).isSymbolicLink(); }
      catch { return false; }
    },
  });
}

function workspaceFiles(root) {
  const files = new Map();
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (!generatedDirectories.has(entry.name)) visit(full);
      } else if (entry.isSymbolicLink()) {
        files.set(relative, 'symlink');
      } else if (entry.isFile()) {
        const mode = fs.statSync(full).mode & 0o111;
        const hash = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        files.set(relative, `${mode}:${hash}`);
      }
    }
  }
  visit(root);
  return files;
}

async function askScoped(config, role, task, context, { allowedPath, strong = false } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-worker-'));
  try {
    copyWorkspace(task.repo, workspace);
    const before = workspaceFiles(workspace);
    const result = await ask(config, role, { ...task, repo: workspace }, context, { strong, skipGitRepoCheck: true });
    const after = workspaceFiles(workspace);
    const attempted = [...new Set([...before.keys(), ...after.keys()])]
      .filter((file) => before.get(file) !== after.get(file)).sort();
    const applied = attempted.filter((file) => allowedPath(file) && after.get(file) !== 'symlink');
    const discarded = attempted.filter((file) => !allowedPath(file) || after.get(file) === 'symlink');
    for (const file of applied) {
      const source = path.join(workspace, file);
      const target = path.join(task.repo, file);
      if (after.has(file)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        fs.chmodSync(target, fs.statSync(source).mode & 0o777);
      } else fs.rmSync(target, { force: true });
    }
    return { result, attempted, applied, discarded };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function readTree(repo, specPaths, limit = 32_000) {
  const chunks = [];
  let length = 0;
  for (const item of specPaths) {
    const full = path.resolve(repo, item);
    if (!full.startsWith(`${path.resolve(repo)}${path.sep}`) || !fs.existsSync(full)) continue;
    const files = fs.statSync(full).isFile() ? [full] : walk(full);
    for (const file of files) {
      try {
        const body = fs.readFileSync(file, 'utf8');
        if (body.includes('\u0000')) continue;
        const relative = path.relative(repo, file);
        const chunk = `\n--- ${relative} ---\n${body}\n`;
        if (length + chunk.length > limit) return `${chunks.join('')}\n[Context truncated at ${limit} characters.]`;
        chunks.push(chunk);
        length += chunk.length;
      } catch { /* Unreadable and binary files are not prompt context. */ }
    }
  }
  return chunks.join('');
}

function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function save(record, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  const body = `# Strata run ${record.run_id}\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
  fs.writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function parseObject(text, role) {
  const value = text.trim();
  try {
    const object = JSON.parse(value);
    if (object && typeof object === 'object' && !Array.isArray(object)) return object;
  } catch { /* Try a fenced or embedded JSON object below. */ }
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1);
  try {
    const object = JSON.parse(candidate);
    if (object && typeof object === 'object' && !Array.isArray(object)) return object;
  } catch { /* Report a stable structured-output error. */ }
  throw new RunError(`${role} did not return a JSON object`);
}

async function ask(config, role, task, context, { strong = false, skipGitRepoCheck = false } = {}) {
  const shape = task.shape ?? '{"status":"pass|fail","summary":"...","findings":[],"changed_paths":[],"commands":[]}';
  const prompt = `You are the Strata ${role}. Follow the supplied Strata specifications and role boundary.\nReturn one JSON object only, matching this shape: ${shape}\n\nTask:\n${task.text}\n\nRepository and supplied context:\n${context}`;
  const response = await invoke(strong ? config.strong : config.worker, prompt, task.repo, role, { skipGitRepoCheck });
  return parseObject(response, role);
}

async function askReadOnly(config, role, task, context, options) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-readonly-'));
  try {
    copyWorkspace(task.repo, workspace);
    return await ask(config, role, { ...task, repo: workspace }, context, { ...options, skipGitRepoCheck: true });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function validatePlan(plan) {
  if (!Array.isArray(plan.stages) || !plan.stages.length) throw new RunError('Epic Coordinator must return a non-empty stages array');
  const seen = new Set();
  const checkpoints = new Set();
  return plan.stages.map((stage, index) => {
    const fields = ['id', 'title', 'concern', 'scope', 'dependencies', 'completion_criteria', 'checkpoint'];
    const missing = fields.filter((key) => !(key in stage));
    if (missing.length) throw new RunError(`Stage ${index + 1} is missing ${missing.join(', ')}`);
    if (typeof stage.id !== 'string' || !stage.id.trim() || seen.has(stage.id)) throw new RunError(`Stage ${index + 1} has a missing or duplicate id`);
    if (!Array.isArray(stage.dependencies) || stage.dependencies.some((dependency) => !seen.has(dependency))) {
      throw new RunError(`Stage ${stage.id} dependencies must refer to earlier stages`);
    }
    if (!Array.isArray(stage.scope) || !stage.scope.length || stage.scope.some((part) => typeof part !== 'string')) {
      throw new RunError(`Stage ${stage.id} scope must be a non-empty array of repository paths or patterns`);
    }
    if (typeof stage.checkpoint !== 'string' || !stage.checkpoint || checkpoints.has(stage.checkpoint)) {
      throw new RunError(`Stage ${stage.id} has a missing or duplicate checkpoint identity`);
    }
    seen.add(stage.id);
    checkpoints.add(stage.checkpoint);
    return { ...stage, status: 'pending', phase_results: [], checkpoint_commit: null };
  });
}

function json(context) { return JSON.stringify(context, null, 2); }
function phaseContext(repo, config) { return readTree(repo, config.workflow.spec_paths); }

export async function startRun(repo, epicPath, config) {
  const absoluteEpic = path.resolve(repo, epicPath);
  if (!fs.existsSync(absoluteEpic) || !fs.statSync(absoluteEpic).isFile()) throw new RunError(`Epic file not found: ${absoluteEpic}`);
  if (git(repo, ['rev-parse', '--is-inside-work-tree']).stdout.trim() !== 'true') throw new RunError('Target directory must be a Git worktree');
  if (snapshot(repo, [config.path, absoluteEpic]).size) throw new RunError('Start from a clean Git worktree apart from the Strata config and selected epic');
  const epic = fs.readFileSync(absoluteEpic, 'utf8');
  const memoryPaths = [config.workflow.memory_path, config.workflow.memory_policy].filter(Boolean);
  const memory = readTree(repo, memoryPaths, 12_000);
  const specs = phaseContext(repo, config);
  const id = runId();
  const file = recordPath(repo, id);
  const record = {
    schema_version: 1, run_id: id, status: 'planning', created_at: now(), repository: repo,
    epic, epic_path: path.relative(repo, absoluteEpic), epic_absolute_path: absoluteEpic, config: config.path,
    memory_consulted: { paths: memoryPaths, excerpt: memory }, stages: [], attempts: [], events: [], archival: { status: 'pending' },
  };
  save(record, file);
  try {
    const plan = await askReadOnly(config, 'Epic Coordinator', {
      repo,
      shape: '{"summary":"...","decisions":[...],"stages":[{"id":"...","title":"...","concern":"...","scope":["path or glob"],"dependencies":[],"completion_criteria":[...],"checkpoint":"stable identity"}]}',
      text: `Inspect the supplied epic, repository snapshot, specifications, and advisory memory. Make architecture decisions and finish the stable stage plan before implementation. Every scope must be a non-empty list of repository paths or glob patterns. Do not implement.\nEPIC:\n${epic}\n\nSPECIFICATIONS:\n${specs}\n\nADVISORY MEMORY:\n${memory}\n\nBranch: ${git(repo, ['branch', '--show-current']).stdout.trim()}\nTracked files:\n${git(repo, ['ls-files']).stdout.slice(0, 20_000)}`,
    }, specs, { strong: true });
    record.plan = { summary: plan.summary ?? '', decisions: plan.decisions ?? [] };
    record.stages = validatePlan(plan);
    record.status = 'planned';
    save(record, file);
    await executeRun(repo, record, config, file);
    return record;
  } catch (error) {
    if (record.status !== 'complete') {
      record.status = 'failed';
      record.failure = error.message;
      record.updated_at = now();
      save(record, file);
    }
    throw error;
  }
}

function stageContract(stage) {
  return Object.fromEntries(['id', 'title', 'concern', 'scope', 'dependencies', 'completion_criteria', 'checkpoint'].map((key) => [key, stage[key]]));
}

function inScope(file, scopes) {
  return scopes.some((scope) => {
    const normalized = scope.replaceAll('\\', '/').replace(/\/$/, '');
    if (normalized === file || file.startsWith(`${normalized}/`)) return true;
    const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('?', '[^/]?').replaceAll('\u0000', '.*');
    return new RegExp(`^${escaped}$`).test(file);
  });
}

function isTestPath(file) {
  const value = file.toLowerCase();
  const name = path.posix.basename(value);
  return value.startsWith('test/') || value.includes('/test/') || value.includes('/tests/') ||
    value.includes('/__tests__/') || name.startsWith('test_') || name.endsWith('_test.py') ||
    /\.(test|spec)\.[^.]+$/.test(name) || name === 'test' || name === 'tests';
}

function runChecks(repo, commands, kind) {
  return commands.map((command) => {
    const result = spawnSync(command[0], command.slice(1), { cwd: repo, encoding: 'utf8', shell: false, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
    if (result.error) return { kind, command, passed: false, error: result.error.message, exit_code: result.status };
    return {
      kind, command, exit_code: result.status, signal: result.signal,
      stdout: (result.stdout ?? '').slice(-12_000), stderr: (result.stderr ?? '').slice(-12_000), passed: result.status === 0,
    };
  });
}

function reviewDiff(repo, files) {
  const tracked = git(repo, ['diff', 'HEAD', '--', ...files]).stdout;
  const untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).stdout
    .split('\0').filter((file) => file && files.includes(file));
  const additions = untracked.map((file) => {
    let content;
    try { content = fs.readFileSync(path.join(repo, file), 'utf8'); }
    catch { content = '[binary or unreadable file]'; }
    return `\n--- /dev/null\n+++ b/${file}\n${content.split('\n').map((line) => `+${line}`).join('\n')}\n`;
  }).join('\n');
  return `${tracked}\n${additions}`;
}

function addPhase(stage, phase, result, extra = {}) {
  stage.phase_results.push({ phase, result, at: now(), ...extra });
}

async function runStage(repo, record, stage, config, file, { repairContext = '' } = {}) {
  stage.status = 'in_progress';
  save(record, file);
  const specContext = phaseContext(repo, config);
  const beforeExplore = runSnapshot(repo, record, file);
  const exploration = await askReadOnly(config, 'Explore Agent', {
    repo,
    shape: '{"status":"pass|fail","findings":[],"files":[],"summary":"...","uncertainties":[]}',
    text: `Read-only repository investigation for this stage. Locate relevant files, conventions, tests, APIs, and dependencies. Do not edit files or decide architecture. Stage contract:\n${json(stageContract(stage))}`,
  }, specContext);
  const afterExplore = runSnapshot(repo, record, file);
  const explorationMutation = changes(beforeExplore, afterExplore);
  addPhase(stage, 'explore', exploration, { observed_changed_paths: explorationMutation });
  save(record, file);
  if (explorationMutation.length) throw new RunError(`Explore Agent modified files: ${explorationMutation.join(', ')}`);

  const coordination = await askReadOnly(config, 'Stage Coordinator', {
    repo,
    shape: '{"implementation_task":"...","review_focus":[...],"test_task":"...","validation_requirements":[...],"memory_handoff":"..."}',
    text: `Coordinate this stage with a fresh context. Do not implement. Convert the contract into bounded work for the implementer, reviewer, tester, and validator; select only relevant memory and record the handoff. Include prior phase results and any repair findings.\nCONTRACT:\n${json(stageContract(stage))}\nEXPLORE FINDINGS:\n${json(exploration)}\nMEMORY:\n${record.memory_consulted.excerpt}\nPRIOR RESULTS:\n${json(stage.phase_results)}\nREPAIR FINDINGS:\n${repairContext}`,
  }, specContext, { strong: true });
  addPhase(stage, 'stage_coordination', coordination);
  save(record, file);

  const beforeImplement = runSnapshot(repo, record, file);
  const implementationAttempt = await askScoped(config, 'Implement Agent', {
    repo,
    text: `Implement the source change within this stage scope. Do not edit tests, specs, memory, run records, or unrelated files. Return observed changed paths and checks. If this is a repair, fix only the reported findings.\nCONTRACT:\n${json(stageContract(stage))}\nCOORDINATOR TASK:\n${coordination.implementation_task}\nREPAIR FINDINGS:\n${repairContext}`,
  }, specContext, {
    allowedPath: (filePath) => !isTestPath(filePath) && !filePath.startsWith('specs/') &&
      filePath !== record.epic_path && inScope(filePath, stage.scope),
  });
  const implementation = implementationAttempt.result;
  const implementChanges = changes(beforeImplement, runSnapshot(repo, record, file));
  addPhase(stage, 'implement', implementation, {
    observed_changed_paths: implementChanges,
    attempted_changed_paths: implementationAttempt.attempted,
    discarded_changed_paths: implementationAttempt.discarded,
  });
  const implementationViolations = implementChanges.filter((filePath) =>
    isTestPath(filePath) || filePath.startsWith('specs/') || filePath === record.epic_path || !inScope(filePath, stage.scope));
  save(record, file);
  if (implementationViolations.length) throw new RunError(`Implementer changed files outside its source scope: ${implementationViolations.join(', ')}`);
  if (implementation.status !== 'pass' || !implementChanges.length) {
    const discarded = implementationAttempt.discarded.length
      ? `; discarded out-of-role writes: ${implementationAttempt.discarded.join(', ')}` : '';
    return { passed: false, reason: `Implementation failed or produced no in-scope source changes${discarded}`, findings: implementation.findings ?? [] };
  }

  const beforeReview = runSnapshot(repo, record, file);
  const review = await askReadOnly(config, 'Review Agent', {
    repo,
    text: `Review the full diff read-only against the stage contract, specs, and repo rules. Pass only with no critical or major issue. Do not edit files.\nCONTRACT:\n${json(stageContract(stage))}\nREVIEW FOCUS:\n${json(coordination.review_focus ?? [])}\nDiff:\n${reviewDiff(repo, implementChanges)}`,
  }, specContext);
  const reviewMutations = changes(beforeReview, runSnapshot(repo, record, file));
  addPhase(stage, 'review', review, { observed_changed_paths: reviewMutations });
  save(record, file);
  if (reviewMutations.length) throw new RunError(`Review Agent modified files: ${reviewMutations.join(', ')}`);

  const beforeTest = runSnapshot(repo, record, file);
  const testerAttempt = await askScoped(config, 'Test Agent', {
    repo,
    text: `Create deterministic tests for required behavior. Change test files only; do not run checks in this disposable workspace because Strata will execute the configured commands in the repository afterward.\nCONTRACT:\n${json(stageContract(stage))}\nCOORDINATOR TASK:\n${coordination.test_task}\nREVIEW FINDINGS:\n${json(review.findings ?? [])}`,
  }, specContext, {
    allowedPath: (filePath) => isTestPath(filePath) && inScope(filePath, stage.scope),
  });
  const tester = testerAttempt.result;
  const testChanges = changes(beforeTest, runSnapshot(repo, record, file));
  const testViolations = testChanges.filter((filePath) => !isTestPath(filePath));
  addPhase(stage, 'test', tester, {
    observed_changed_paths: testChanges,
    attempted_changed_paths: testerAttempt.attempted,
    discarded_changed_paths: testerAttempt.discarded,
    scope_violations: testViolations,
  });
  save(record, file);
  const evidence = [
    ...runChecks(repo, config.workflow.test_commands, 'test'),
    ...runChecks(repo, config.workflow.quality_checks, 'quality'),
  ];
  addPhase(stage, 'engine_checks', evidence);
  save(record, file);

  const beforeValidate = runSnapshot(repo, record, file);
  const validation = await askReadOnly(config, 'Validate Agent', {
    repo,
    text: `Read-only gate. Check spec coverage, review resolution, test evidence, configured quality checks, repository rules, and scope. A missing/skipped required check fails. Do not edit anything.\nCONTRACT:\n${json(stageContract(stage))}\nCOORDINATOR REQUIREMENTS:\n${json(coordination.validation_requirements ?? [])}\nREVIEW:\n${json(review)}\nTESTER:\n${json(tester)}\nENGINE EVIDENCE:\n${json(evidence)}`,
  }, specContext);
  const validationMutations = changes(beforeValidate, runSnapshot(repo, record, file));
  addPhase(stage, 'validate', validation, { observed_changed_paths: validationMutations });
  save(record, file);
  if (validationMutations.length) throw new RunError(`Validate Agent modified files: ${validationMutations.join(', ')}`);

  const passed = review.status === 'pass' && !(review.findings ?? []).some((item) => ['critical', 'major'].includes(String(item.severity).toLowerCase())) &&
    tester.status === 'pass' && !testViolations.length && config.workflow.test_commands.length > 0 &&
    evidence.some((item) => item.kind === 'test') && evidence.every((item) => item.passed) &&
    validation.status === 'pass' && !validationMutations.length;
  return {
    passed,
    reason: passed ? '' : 'A required stage gate failed or required test evidence is unavailable',
    findings: { implementation: implementation.findings ?? [], review: review.findings ?? [], test: tester.findings ?? [], validation: validation.findings ?? [], evidence },
  };
}

function checkpoint(repo, stage, config, record, file, attempt) {
  const changed = changes(new Map(), runSnapshot(repo, record, file));
  const eligible = changed.filter((filePath) => !filePath.startsWith('specs/') && !filePath.startsWith('docs/temps/'));
  if (config.workflow.checkpoint) {
    if (!eligible.length) throw new RunError(`No files to checkpoint for stage ${stage.id}`);
    const add = git(repo, ['add', '-A', '--', ...eligible], { allowFailure: true });
    if (add.status !== 0) throw new RunError(add.stderr.trim());
    const message = `${config.workflow.checkpoint_prefix}: ${stage.id} ${stage.title} [${stage.checkpoint}]${attempt > 1 ? ` repair-${attempt}` : ''}`;
    const commit = git(repo, ['commit', '-m', message], { allowFailure: true });
    if (commit.status !== 0) throw new RunError(`Checkpoint failed for ${stage.id}: ${commit.stderr.trim()}`);
    stage.checkpoint_commit = git(repo, ['rev-parse', 'HEAD']).stdout.trim();
  }
  stage.status = 'complete';
  stage.completed_at = now();
  save(record, file);
}

async function runStageWithRepairs(repo, record, stage, config, file, initialFinding = '') {
  let repairContext = initialFinding;
  for (let attemptIndex = 0; attemptIndex <= config.workflow.max_repairs; attemptIndex += 1) {
    let result;
    try {
      result = await runStage(repo, record, stage, config, file, { repairContext });
    } catch (error) {
      result = { passed: false, reason: error.message, findings: [error.message] };
    }
    const attempt = {
      stage_id: stage.id, number: attemptIndex + 1, passed: result.passed,
      reason: result.reason, findings: result.findings, at: now(),
    };
    record.attempts.push(attempt);
    save(record, file);
    if (result.passed) {
      checkpoint(repo, stage, config, record, file, attemptIndex + 1);
      return;
    }
    if (attemptIndex < config.workflow.max_repairs) {
      record.events.push({ type: 'repair', stage_id: stage.id, attempt: attemptIndex + 1, details: result.findings, at: now() });
      repairContext = json(result.findings);
      save(record, file);
    }
  }
  stage.status = 'failed';
  stage.failure = record.attempts.at(-1)?.reason;
  save(record, file);
  throw new RunError(`Stage ${stage.id} halted: ${stage.failure}`);
}

async function finalValidation(repo, record, config, file) {
  const context = phaseContext(repo, config);
  const review = await askReadOnly(config, 'Epic Coordinator', {
    repo,
    shape: '{"status":"pass|fail","findings":[],"target_stage_id":"optional stage id"}',
    text: `Review epic criteria, cross-stage consistency, regressions, and architecture. Check only completed work and return a target_stage_id if a targeted stage repair is needed.\nEPIC:\n${record.epic}\nSTAGE RESULTS:\n${json(record.stages)}`,
  }, context, { strong: true });
  const evidence = [...runChecks(repo, config.workflow.test_commands, 'final_test'), ...runChecks(repo, config.workflow.quality_checks, 'final_quality')];
  const beforeValidator = runSnapshot(repo, record, file);
  const validator = await askReadOnly(config, 'Validate Agent', {
    repo,
    shape: '{"status":"pass|fail","findings":[],"gates":[{"name":"...","passed":true,"evidence":"..."}]}',
    text: `Read-only final validation of epic criteria, stage results, review findings, test evidence, configured quality checks, repository rules, and plan integrity. Missing or skipped required checks fail. Do not edit files.\nEPIC:\n${record.epic}\nSTAGES:\n${json(record.stages)}\nEPIC REVIEW:\n${json(review)}\nENGINE EVIDENCE:\n${json(evidence)}`,
  }, context);
  const validatorMutations = changes(beforeValidator, runSnapshot(repo, record, file));
  record.final_review = review;
  record.final_validation = { result: validator, observed_changed_paths: validatorMutations };
  record.final_evidence = evidence;
  record.final_validated_at = now();
  const passed = review.status === 'pass' && !(review.findings ?? []).length &&
    validator.status === 'pass' && !validatorMutations.length &&
    config.workflow.test_commands.length > 0 && evidence.some((item) => item.kind === 'final_test') && evidence.every((item) => item.passed);
  save(record, file);
  return { passed, review, evidence };
}

async function archiveMemory(repo, record, config) {
  const current = readTree(repo, [config.workflow.memory_path], 12_000);
  const result = await askReadOnly(config, 'Archivist', {
    repo,
    shape: '{"entries":[{"class":"decision|note|progress","content":"..."}]}',
    text: `This run succeeded. Review it and current memory; propose only observed reusable engineering knowledge, check duplicates, and never include credentials, secrets, private content, or raw application data. Do not write specs, tests, or source. Include date, affected paths, and run id in entries.\nRUN:\n${json(record)}\nCURRENT MEMORY:\n${current}`,
  }, current, { strong: true });
  const entries = Array.isArray(result.entries) ? result.entries : [];
  if (!entries.length) return { status: 'complete', entries: 0 };
  const directory = path.resolve(repo, config.workflow.memory_path);
  if (!directory.startsWith(`${path.resolve(repo)}${path.sep}`)) throw new RunError('Configured memory path must remain inside the repository');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, 'archive.md');
  for (const entry of entries) {
    if (!entry?.content || !['decision', 'note', 'progress'].includes(entry.class)) continue;
    if (/(api[_ -]?key|secret|password|token)\s*[:=]\s*\S+/i.test(entry.content)) continue;
    if (current.includes(entry.content)) continue;
    fs.appendFileSync(target, `\n## ${entry.class[0].toUpperCase()}${entry.class.slice(1)} — ${now().slice(0, 10)}\n\n${entry.content}\n`, 'utf8');
  }
  return { status: 'complete', entries: entries.length, path: path.relative(repo, target) };
}

async function executeRun(repo, record, config, file) {
  record.status = 'running';
  save(record, file);
  for (const stage of record.stages) {
    if (stage.status === 'complete') continue;
    if (stage.dependencies.some((id) => record.stages.find((item) => item.id === id)?.status !== 'complete')) {
      throw new RunError(`Stage ${stage.id} dependencies are incomplete`);
    }
    await runStageWithRepairs(repo, record, stage, config, file, stage.failure ?? '');
  }
  let final = await finalValidation(repo, record, config, file);
  let repairs = 0;
  while (!final.passed && repairs < config.workflow.max_repairs) {
    const target = record.stages.find((stage) => stage.id === final.review.target_stage_id) ?? record.stages.at(-1);
    repairs += 1;
    record.events.push({ type: 'final_repair', stage_id: target.id, findings: final.review.findings, at: now() });
    target.status = 'pending';
    save(record, file);
    await runStageWithRepairs(repo, record, target, config, file, json({ final_review: final.review, evidence: final.evidence }));
    final = await finalValidation(repo, record, config, file);
  }
  if (!final.passed) throw new RunError('Final integration review or validation failed; run record is preserved for resumption');
  if (config.workflow.checkpoint) {
    const tag = `${config.workflow.checkpoint_prefix}-epic-${record.run_id}`;
    const result = git(repo, ['tag', '-a', tag, '-m', `Completed Strata epic ${record.run_id}`], { allowFailure: true });
    if (result.status !== 0) throw new RunError(`Epic checkpoint failed: ${result.stderr.trim()}`);
    record.epic_checkpoint = tag;
  }
  record.status = 'complete';
  record.completed_at = now();
  save(record, file);
  try {
    record.archival = await archiveMemory(repo, record, config);
  } catch (error) {
    record.archival = { status: 'failed', reason: error.message };
  }
  save(record, file);
}

export function loadRun(file) {
  const contents = fs.readFileSync(file, 'utf8');
  const fenced = contents.match(/```json\s*([\s\S]*?)```/i);
  const record = JSON.parse(fenced?.[1] ?? contents);
  if (record.schema_version !== 1) throw new RunError(`Unsupported run record version: ${file}`);
  return record;
}

export async function resumeRun(repo, runFile, config) {
  const file = path.isAbsolute(runFile) ? runFile : path.resolve(repo, runFile);
  const record = loadRun(file);
  if (record.status === 'complete') return record;
  if (!['planned', 'failed', 'running'].includes(record.status)) throw new RunError(`Run with status ${record.status} cannot be resumed`);
  for (const stage of record.stages) if (stage.status === 'in_progress' || stage.status === 'failed') stage.status = 'pending';
  delete record.failure;
  await executeRun(repo, record, config, file);
  return record;
}

export { recordPath };
