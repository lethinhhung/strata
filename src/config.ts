import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';

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
max_repairs = 2
checkpoint = true
checkpoint_prefix = "strata"
spec_paths = ["specs"]
memory_path = ".strata/memory"
memory_policy = ""
quality_checks = []
test_commands = []`;

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
}

interface ModelConfig { provider: string; model: string; command: string; timeout_seconds: number; extra_args: string[] }
interface LoadedConfig { strong: ModelConfig; worker: ModelConfig; workflow: Workflow; path: string }

interface ConfigRaw {
  models?: { strong?: ModelConfigRaw; worker?: ModelConfigRaw };
  workflow?: Partial<Workflow>;
}

const modelConfig = (raw: ModelConfigRaw = {}, provider: string, command: string): ModelConfig => ({
  provider: String(raw.provider ?? provider),
  model: String(raw.model ?? ''),
  command: String(raw.command ?? command),
  timeout_seconds: Number(raw.timeout_seconds ?? 1800),
  extra_args: Array.isArray(raw.extra_args) ? raw.extra_args.map(String) : [],
});

export interface Workflow {
  max_repairs: number;
  checkpoint: boolean;
  checkpoint_prefix: string;
  spec_paths: string[];
  memory_path: string;
  memory_policy: string;
  quality_checks: string[][];
  test_commands: string[][];
  setup_commands: string[][];
  require_agent_gates: boolean;
  checks?: WorkflowCheck[];
}

export interface WorkflowCheck {
  id: string;
  kind: 'test' | 'quality';
  command: string[];
  allow_unavailable: boolean;
  unavailable_reason: string;
}

export function loadConfig(repo: string, explicit?: string): LoadedConfig {
    const configPath = explicit ? path.resolve(repo, explicit) : path.join(repo, '.strata.toml');
    if (!fs.existsSync(configPath)) throw new Error(`No Strata config at ${configPath}; run \`strata init\` first`);
    const raw = parse(fs.readFileSync(configPath, 'utf8')) as unknown as ConfigRaw;
    
    const workflowRaw = raw.workflow ?? {};
    const workflow: Workflow = {
      max_repairs: typeof workflowRaw.max_repairs === 'number' ? workflowRaw.max_repairs : 2,
      checkpoint: typeof workflowRaw.checkpoint === 'boolean' ? workflowRaw.checkpoint : true,
      checkpoint_prefix: typeof workflowRaw.checkpoint_prefix === 'string' ? workflowRaw.checkpoint_prefix : 'strata',
      spec_paths: Array.isArray(workflowRaw.spec_paths) 
        ? workflowRaw.spec_paths.filter((item): item is string => typeof item === 'string').map(String) 
        : ['specs'],
      memory_path: typeof workflowRaw.memory_path === 'string' ? workflowRaw.memory_path : '.strata/memory',
      memory_policy: typeof workflowRaw.memory_policy === 'string' ? workflowRaw.memory_policy : '',
      quality_checks: commandList(workflowRaw.quality_checks),
      test_commands: commandList(workflowRaw.test_commands),
      setup_commands: commandList(workflowRaw.setup_commands),
      require_agent_gates: typeof workflowRaw.require_agent_gates === 'boolean' ? workflowRaw.require_agent_gates : true,
      checks: configuredChecks(workflowRaw.checks, commandList(workflowRaw.test_commands), commandList(workflowRaw.quality_checks)),
    };
    
    if (!Number.isInteger(workflow.max_repairs) || workflow.max_repairs < 0) throw new Error('workflow.max_repairs must be a non-negative integer');
    if (workflow.checkpoint !== true) throw new Error('workflow.checkpoint must be true; stage and epic checkpoints are required by specs/core.md');
    
    const modelsRaw = raw.models ?? {};
    const strongRaw = modelsRaw.strong ?? {};
    const workerRaw = modelsRaw.worker ?? {};
    
    const strong = modelConfig(strongRaw, 'codex', 'codex');
    const worker = modelConfig(workerRaw, 'opencode', 'opencode');
    
    strong.model = process.env.STRATA_STRONG_MODEL ?? strong.model;
    worker.model = process.env.STRATA_WORKER_MODEL ?? worker.model;
    
    return { strong, worker, workflow, path: configPath };
  }

function commandList(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.map((command) => {
    if (!Array.isArray(command) || !command.length || command.some((part) => typeof part !== 'string')) {
      throw new Error('Each workflow command must be a non-empty array of strings');
    }
    return command.map(String);
  });
}

function configuredChecks(value: unknown, tests: string[][], quality: string[][]): WorkflowCheck[] {
  const legacy = [
    ...tests.map((command, index) => ({ id: `test-${index + 1}`, kind: 'test' as const, command, allow_unavailable: false, unavailable_reason: '' })),
    ...quality.map((command, index) => ({ id: `quality-${index + 1}`, kind: 'quality' as const, command, allow_unavailable: false, unavailable_reason: '' })),
  ];
  if (value === undefined || (Array.isArray(value) && value.length === 0 && legacy.length > 0)) return legacy;
  if (!Array.isArray(value)) throw new Error('workflow.checks must be an array of check tables');
  const checks = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`workflow.checks[${index}] must be a table`);
    const check = item as Record<string, unknown>;
    const id = typeof check.id === 'string' ? check.id.trim() : '';
    const kind = check.kind;
    if (!id || (kind !== 'test' && kind !== 'quality')) throw new Error(`workflow.checks[${index}] requires an id and kind "test" or "quality"`);
    const checkKind: WorkflowCheck['kind'] = kind;
    const command = commandList([check.command])[0];
    if (typeof check.allow_unavailable !== 'undefined' && typeof check.allow_unavailable !== 'boolean') throw new Error(`workflow.checks[${index}].allow_unavailable must be a boolean`);
    const allowUnavailable = check.allow_unavailable === true;
    const unavailableReason = typeof check.unavailable_reason === 'string' ? check.unavailable_reason.trim() : '';
    if (allowUnavailable && !unavailableReason) throw new Error(`workflow.checks[${index}] needs unavailable_reason when allow_unavailable is true`);
    return { id, kind: checkKind, command, allow_unavailable: allowUnavailable, unavailable_reason: unavailableReason };
  });
  const ids = new Set<string>();
  for (const check of checks) {
    if (ids.has(check.id)) throw new Error(`Duplicate workflow check id: ${check.id}`);
    ids.add(check.id);
  }
  return checks;
}
