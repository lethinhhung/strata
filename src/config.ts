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
