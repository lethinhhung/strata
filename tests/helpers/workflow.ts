import { vi } from 'vitest';
import { invoke, run } from '../../src/provider.js';
import { write } from './fixtures.js';

export const stage = (id = 'first', dependencies: string[] = []) => ({
  id, title: id, objective: `Implement ${id}`, dependencies, completion_criteria: ['Checks pass'],
});
export type StagePlan = ReturnType<typeof stage>;
export type Invocation = { role: string; prompt: string; repo: string; readOnly: boolean; stage?: StagePlan };
export type Script = (call: Invocation) => string | undefined | Promise<string | undefined>;

export async function scriptedWorkflow(stages: StagePlan[] = [stage()], script?: Script) {
  const actual = await vi.importActual<typeof import('../../src/provider.js')>('../../src/provider.js');
  vi.mocked(run).mockImplementation(actual.run);
  const calls: Invocation[] = [];
  vi.mocked(invoke).mockImplementation(async (_agent, prompt, repo, readOnly = false) => {
    const role = prompt.match(/^You are Strata's ([^.]+)\./)?.[1] ?? '';
    const contract = prompt.match(/## contract\n([\s\S]*?)(?:\n\n##|$)/)?.[1];
    const currentStage = contract ? JSON.parse(contract).stage as StagePlan : undefined;
    const call = { role, prompt, repo, readOnly, stage: currentStage };
    calls.push(call);
    const response = await script?.(call);
    if (response !== undefined) return response;
    if (role === 'epic coordinator') {
      return prompt.includes('## task\nIdentify')
        ? JSON.stringify({ exploration_tasks: [{ question: 'Inspect fixture' }] })
        : JSON.stringify({ stages, blockers: [] });
    }
    if (role === 'explore agent') return 'Fixture exploration findings';
    if (role === 'stage coordinator') return JSON.stringify({ implementation_tasks: [{ task: 'Implement fixture' }] });
    if (role === 'implementer') {
      write(repo, `src/${currentStage!.id}.ts`, '// scripted implementation\n');
      return 'Implemented fixture';
    }
    if (role === 'tester' || role === 'validator') return JSON.stringify({ status: 'pass', findings: [], summary: 'Verified fixture' });
    if (role === 'archivist') {
      write(repo, `memory/${currentStage!.id}.md`, 'Fixture durable notes\n');
      return 'Archived';
    }
    throw new Error(`Unexpected workflow role ${role}`);
  });
  return { calls, actualRun: actual.run };
}
