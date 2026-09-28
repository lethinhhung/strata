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
test_commands = []
`;

export function initConfig(repo, force = false) {
  const configPath = path.join(repo, '.strata.toml');
  if (fs.existsSync(configPath) && !force) throw new Error(`${configPath} already exists (use --force to replace it)`);
  fs.writeFileSync(configPath, DEFAULT_CONFIG, 'utf8');
  return configPath;
}

const modelConfig = (raw = {}, provider, command) => ({
  provider: String(raw.provider ?? provider),
  model: String(raw.model ?? ''),
  command: String(raw.command ?? command),
  timeout_seconds: Number(raw.timeout_seconds ?? 1800),
  extra_args: Array.isArray(raw.extra_args) ? raw.extra_args.map(String) : [],
});

export function loadConfig(repo, explicit) {
  const configPath = explicit ? path.resolve(repo, explicit) : path.join(repo, '.strata.toml');
  if (!fs.existsSync(configPath)) throw new Error(`No Strata config at ${configPath}; run \`strata init\` first`);
  const raw = parse(fs.readFileSync(configPath, 'utf8'));
  const w = raw.workflow ?? {};
  const workflow = {
    max_repairs: Number(w.max_repairs ?? 2),
    checkpoint: w.checkpoint ?? true,
    checkpoint_prefix: String(w.checkpoint_prefix ?? 'strata'),
    spec_paths: Array.isArray(w.spec_paths) ? w.spec_paths.map(String) : ['specs'],
    memory_path: String(w.memory_path ?? '.strata/memory'),
    memory_policy: String(w.memory_policy ?? ''),
    quality_checks: commandList(w.quality_checks),
    test_commands: commandList(w.test_commands),
  };
  if (!Number.isInteger(workflow.max_repairs) || workflow.max_repairs < 0) throw new Error('workflow.max_repairs must be a non-negative integer');
  if (workflow.checkpoint !== true) throw new Error('workflow.checkpoint must be true; stage and epic checkpoints are required by specs/core.md');
  const strong = modelConfig(raw.models?.strong, 'codex', 'codex');
  const worker = modelConfig(raw.models?.worker, 'opencode', 'opencode');
  strong.model = process.env.STRATA_STRONG_MODEL ?? strong.model;
  worker.model = process.env.STRATA_WORKER_MODEL ?? worker.model;
  return {
    strong,
    worker,
    workflow,
    path: configPath,
  };
}

function commandList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((command) => {
    if (!Array.isArray(command) || !command.length || command.some((part) => typeof part !== 'string')) {
      throw new Error('Each workflow command must be a non-empty array of strings');
    }
    return command;
  });
}
