import { RunError } from './types.js';

export function validatePlan(plan: any) {
  if (!Array.isArray(plan.stages) || !plan.stages.length) throw new RunError('Epic Coordinator must return a non-empty stages array');
  const seen = new Set();
  const checkpoints = new Set();
  return plan.stages.map((stage: any, index: number) => {
    const fields = ['id', 'title', 'concern', 'dependencies', 'completion_criteria', 'checkpoint'];
    const missing = fields.filter((key) => !(key in stage));
    if (missing.length) throw new RunError(`Stage ${index + 1} is missing ${missing.join(', ')}`);
    if (typeof stage.id !== 'string' || !stage.id.trim() || seen.has(stage.id)) throw new RunError(`Stage ${index + 1} has a missing or duplicate id`);
    if (!Array.isArray(stage.dependencies) || stage.dependencies.some((dependency: string) => !seen.has(dependency))) {
      throw new RunError(`Stage ${stage.id} dependencies must refer to earlier stages`);
    }
    if (typeof stage.checkpoint !== 'string' || !stage.checkpoint || checkpoints.has(stage.checkpoint)) {
      throw new RunError(`Stage ${stage.id} has a missing or duplicate checkpoint identity`);
    }
    seen.add(stage.id);
    checkpoints.add(stage.checkpoint);
    const normalized = { ...stage };
    delete normalized.scope;
    delete normalized.kind;
    delete normalized.mechanical;
    return { ...normalized, status: 'pending', phase_results: [], checkpoint_commit: null };
  });
}
