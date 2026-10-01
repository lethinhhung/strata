import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';
import { loadWorkflow, Workflow } from './workflowConfig.js';

export const DEFAULT_CONFIG = `# Model IDs are interpreted by the local CLIs; credentials stay outside this file.
[models.strong]
provider = "codex"
model = ""
command = "codex"
timeout_seconds = 3600

[models.worker]
provider = "opencode"
model = ""
command = "opencode"
timeout_seconds = 1800

[workflow]
checkpoint = true
checkpoint_prefix = "strata"
spec_paths = ["specs"]
memory_path = ".strata/memory"
memory_policy = ""
`;

export function initConfig(repo: string, force = false): string {
  const configPath = path.join(repo, '.strata.toml');
  if (fs.existsSync(configPath) && !force) throw new Error(`${configPath} already exists (use --force to replace it)`);
  fs.writeFileSync(configPath, DEFAULT_CONFIG, 'utf8');
  return configPath;
}

interface ModelConfigRaw {
  provider?: string;
  model?: string;
  command?: string;
  timeout_seconds?: number;
  extra_args?: unknown[];
  instructions_path?: string;
}

interface ModelConfig { provider: string; model: string; command: string; timeout_seconds: number; extra_args: string[] }
interface LoadedConfig { strong: ModelConfig; worker: ModelConfig; workflow: Workflow; roles: Record<string, { model: ModelConfig; instructions: string }>; path: string }

interface ConfigRaw { models?: { strong?: ModelConfigRaw; worker?: ModelConfigRaw }; roles?: Record<string, ModelConfigRaw>; workflow?: Partial<Workflow> }

const modelConfig = (raw: ModelConfigRaw = {}, provider: string, command: string): ModelConfig => ({
  provider: String(raw.provider ?? provider),
  model: String(raw.model ?? ''),
  command: String(raw.command ?? command),
  timeout_seconds: Number(raw.timeout_seconds ?? 1800),
  extra_args: Array.isArray(raw.extra_args) ? raw.extra_args.map(String) : [],
});

export function loadConfig(repo: string, explicit?: string): LoadedConfig {
    const configPath = explicit ? path.resolve(repo, explicit) : path.join(repo, '.strata.toml');
    if (!fs.existsSync(configPath)) throw new Error(`No Strata config at ${configPath}; run \`strata init\` first`);
    const raw = parse(fs.readFileSync(configPath, 'utf8')) as unknown as ConfigRaw;
    
    const discovered = discoverNodeChecks(repo, raw.workflow);
    const workflow = loadWorkflow({ ...raw.workflow, ...(discovered ? { checks: discovered } : {}) });
    const modelsRaw = raw.models ?? {};
    const strongRaw = modelsRaw.strong ?? {};
    const workerRaw = modelsRaw.worker ?? {};
    
    const strong = modelConfig(strongRaw, 'codex', 'codex');
    const worker = modelConfig(workerRaw, 'opencode', 'opencode');
    
    strong.model = process.env.STRATA_STRONG_MODEL ?? strong.model;
    worker.model = process.env.STRATA_WORKER_MODEL ?? worker.model;

    const roles: Record<string, { model: ModelConfig; instructions: string }> = {};
    for (const [name, definition] of Object.entries(raw.roles ?? {})) {
      const slug = roleSlug(name);
      const isCoordinator = slug === 'epic_coordinator' || slug === 'stage_coordinator';
      const fallback = isCoordinator ? strong : worker;
      const provider = definition.provider ?? fallback.provider;
      const defaultCommand = provider === 'codex' ? 'codex' : provider === 'opencode' ? 'opencode' : fallback.command;
      const model = modelConfig(definition, fallback.provider, defaultCommand);
      if (definition.model === undefined) model.model = fallback.model;
      if (definition.timeout_seconds === undefined) model.timeout_seconds = fallback.timeout_seconds;
      if (definition.extra_args === undefined) model.extra_args = [...fallback.extra_args];
      const roleFile = definition.instructions_path
        ? path.resolve(repo, definition.instructions_path)
        : path.join(repo, '.strata', 'roles', `${slug}.md`);
      const instructions = fs.existsSync(roleFile) ? fs.readFileSync(roleFile, 'utf8') : '';
      roles[slug] = { model, instructions };
    }
    const roleDirectory = path.join(repo, '.strata', 'roles');
    if (fs.existsSync(roleDirectory)) {
      for (const name of fs.readdirSync(roleDirectory).filter((item) => item.endsWith('.md'))) {
        const slug = roleSlug(name.slice(0, -3));
        if (roles[slug]) continue;
        const isCoordinator = slug === 'epic_coordinator' || slug === 'stage_coordinator';
        roles[slug] = {
          model: isCoordinator ? strong : worker,
          instructions: fs.readFileSync(path.join(roleDirectory, name), 'utf8'),
        };
      }
    }

    return { strong, worker, workflow, roles, path: configPath };
  }

function roleSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function discoverNodeChecks(repo: string, workflow: Partial<Workflow> | undefined) {
  if (workflow?.checks !== undefined) return undefined;
  if (workflow?.test_commands?.length || workflow?.quality_checks?.length) return undefined;
  const packagePath = path.join(repo, 'package.json');
  if (!fs.existsSync(packagePath)) return undefined;
  let scripts: Record<string, string>;
  try { scripts = JSON.parse(fs.readFileSync(packagePath, 'utf8')).scripts ?? {}; }
  catch { return undefined; }
  let manager = 'npm';
  if (fs.existsSync(path.join(repo, 'pnpm-lock.yaml'))) manager = 'pnpm';
  else if (fs.existsSync(path.join(repo, 'yarn.lock'))) manager = 'yarn';
  else if (fs.existsSync(path.join(repo, 'bun.lock')) || fs.existsSync(path.join(repo, 'bun.lockb'))) manager = 'bun';
  const run = (script: string) => manager === 'npm' ? ['npm', 'run', script] : [manager, 'run', script];
  const checks: NonNullable<Workflow['checks']> = [];
  const testScript = scripts['test:ci'] ? 'test:ci' : scripts.test ? 'test' : undefined;
  if (testScript) checks.push({ id: testScript, kind: 'test', command: run(testScript), allow_unavailable: false, unavailable_reason: '' });
  for (const script of ['lint', 'typecheck', 'build']) {
    if (scripts[script]) checks.push({ id: script, kind: 'quality', command: run(script), allow_unavailable: false, unavailable_reason: '' });
  }
  return checks;
}
