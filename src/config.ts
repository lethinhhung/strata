import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';

export interface AgentConfig {
  provider: 'codex' | 'opencode';
  model: string;
  command: string;
  timeout_seconds: number;
  idle_timeout_seconds?: number;
  extra_args: string[];
}

export interface WorkflowConfig {
  implement_fix_attempts: number;
  spec_paths: string[];
  memory_path: string;
  checks: string[][];
}

export interface StrataConfig {
  strong: AgentConfig;
  worker: AgentConfig;
  workflow: WorkflowConfig;
}

export const DEFAULT_CONFIG = `# Provider credentials are managed by each local CLI.
[models.strong]
provider = "codex"
model = ""
command = "codex"
timeout_seconds = 3600

[models.worker]
provider = "opencode"
model = "nvidia/openai/gpt-oss-20b"
command = "opencode"
timeout_seconds = 1800
idle_timeout_seconds = 360

[workflow]
implement_fix_attempts = 3
spec_paths = ["specs", "AGENTS.md", "RULES.md"]
memory_path = "memory"
checks = []
`;

export function initConfig(repo: string, force = false): string {
  const file = path.join(repo, '.strata.toml');
  if (fs.existsSync(file) && !force) throw new Error(`${file} already exists (use --force to replace it)`);
  fs.writeFileSync(file, DEFAULT_CONFIG, 'utf8');
  return file;
}

export function loadConfig(repo: string, explicit?: string): StrataConfig {
  const file = explicit ? path.resolve(repo, explicit) : path.join(repo, '.strata.toml');
  const raw = parse(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : DEFAULT_CONFIG) as Record<string, any>;
  const model = (name: 'strong' | 'worker', fallback: AgentConfig): AgentConfig => {
    const input = raw.models?.[name] ?? {};
    const provider = input.provider ?? fallback.provider;
    if (provider !== 'codex' && provider !== 'opencode') throw new Error(`Unsupported provider for models.${name}: ${provider}`);
    const timeout = Number(input.timeout_seconds ?? fallback.timeout_seconds);
    const idleTimeout = Number(input.idle_timeout_seconds ?? (provider === 'opencode' ? 360 : 0));
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error(`models.${name}.timeout_seconds must be a positive number`);
    if (!Number.isFinite(idleTimeout) || idleTimeout < 0) throw new Error(`models.${name}.idle_timeout_seconds must be a non-negative number`);
    return {
      provider,
      model: String(input.model ?? ''),
      command: String(input.command ?? provider),
      timeout_seconds: timeout,
      idle_timeout_seconds: idleTimeout,
      extra_args: Array.isArray(input.extra_args) ? input.extra_args.map(String) : [],
    };
  };
  const defaults = raw.workflow ?? {};
  const configuredAttempts = defaults.implement_fix_attempts;
  const configuredRepairs = defaults.max_repairs;
  if (configuredAttempts !== undefined && configuredRepairs !== undefined) {
    throw new Error('Set only one of workflow.implement_fix_attempts or workflow.max_repairs');
  }
  const repairs = Number(configuredRepairs ?? 2);
  if (configuredRepairs !== undefined && (!Number.isInteger(repairs) || repairs < 0)) {
    throw new Error('workflow.max_repairs must be a non-negative integer');
  }
  const attempts = Number(configuredAttempts ?? (configuredRepairs === undefined ? 3 : repairs + 1));
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('workflow.implement_fix_attempts must be a positive integer');
  const checks = defaults.checks ?? [];
  if (!Array.isArray(checks) || checks.some((c: unknown) => !Array.isArray(c) || c.length === 0 || c.some((v) => typeof v !== 'string'))) {
    throw new Error('workflow.checks must be an array of non-empty command arrays');
  }
  return {
    strong: model('strong', { provider: 'codex', model: '', command: 'codex', timeout_seconds: 3600, extra_args: [] }),
    worker: model('worker', { provider: 'opencode', model: '', command: 'opencode', timeout_seconds: 1800, extra_args: [] }),
    workflow: {
      implement_fix_attempts: attempts,
      spec_paths: Array.isArray(defaults.spec_paths) ? defaults.spec_paths.map(String) : ['specs', 'AGENTS.md', 'RULES.md'],
      memory_path: String(defaults.memory_path ?? 'memory'),
      checks: checks.map((c: string[]) => c.map(String)),
    },
  };
}
