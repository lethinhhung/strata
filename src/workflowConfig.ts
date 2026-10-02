export interface Workflow {
  max_repairs: number;
  review_repair_attempts: number;
  test_repair_attempts: number;
  validation_repair_attempts: number;
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

export function loadWorkflow(raw: Partial<Workflow> = {}): Workflow {
  const tests = commandList(raw.test_commands);
  const quality = commandList(raw.quality_checks);
  const workflow: Workflow = {
    max_repairs: typeof raw.max_repairs === 'number' ? raw.max_repairs : 2,
    review_repair_attempts: typeof raw.review_repair_attempts === 'number' ? raw.review_repair_attempts : 3,
    test_repair_attempts: typeof raw.test_repair_attempts === 'number' ? raw.test_repair_attempts : 3,
    validation_repair_attempts: typeof raw.validation_repair_attempts === 'number' ? raw.validation_repair_attempts : 3,
    checkpoint: typeof raw.checkpoint === 'boolean' ? raw.checkpoint : true,
    checkpoint_prefix: typeof raw.checkpoint_prefix === 'string' ? raw.checkpoint_prefix : 'strata',
    spec_paths: Array.isArray(raw.spec_paths) ? raw.spec_paths.filter((item): item is string => typeof item === 'string') : ['specs'],
    memory_path: typeof raw.memory_path === 'string' ? raw.memory_path : '.strata/memory',
    memory_policy: typeof raw.memory_policy === 'string' ? raw.memory_policy : '',
    quality_checks: quality,
    test_commands: tests,
    setup_commands: commandList(raw.setup_commands),
    require_agent_gates: typeof raw.require_agent_gates === 'boolean' ? raw.require_agent_gates : true,
    checks: configuredChecks(raw.checks, tests, quality),
  };
  if (!Number.isInteger(workflow.max_repairs) || workflow.max_repairs < 0) throw new Error('workflow.max_repairs must be a non-negative integer');
  for (const key of ['review_repair_attempts', 'test_repair_attempts', 'validation_repair_attempts'] as const) {
    if (!Number.isInteger(workflow[key]) || workflow[key] < 0) throw new Error(`workflow.${key} must be a non-negative integer`);
  }
  if (!workflow.checkpoint) throw new Error('workflow.checkpoint must be true; stage and epic checkpoints are required by specs/core.md');
  return workflow;
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
    const kind = check.kind as WorkflowCheck['kind'];
    if (!id || (kind !== 'test' && kind !== 'quality')) throw new Error(`workflow.checks[${index}] requires an id and kind "test" or "quality"`);
    const command = commandList([check.command])[0];
    if (typeof check.allow_unavailable !== 'undefined' && typeof check.allow_unavailable !== 'boolean') throw new Error(`workflow.checks[${index}].allow_unavailable must be a boolean`);
    const allowUnavailable = check.allow_unavailable === true;
    const unavailableReason = typeof check.unavailable_reason === 'string' ? check.unavailable_reason.trim() : '';
    if (allowUnavailable && !unavailableReason) throw new Error(`workflow.checks[${index}] needs unavailable_reason when allow_unavailable is true`);
    return { id, kind, command, allow_unavailable: allowUnavailable, unavailable_reason: unavailableReason };
  });
  const ids = new Set<string>();
  for (const check of checks) {
    if (ids.has(check.id)) throw new Error(`Duplicate workflow check id: ${check.id}`);
    ids.add(check.id);
  }
  return checks;
}
