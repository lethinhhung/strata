import type { ProgressEntry } from './types.js';
import { save } from './save.js';

type AgentSubtype = Extract<ProgressEntry, { type: 'agent' }>['subtype'];

export async function agentStep<T>(record: any, file: string, subtype: AgentSubtype,
  stageId: string, action: () => Promise<T>, role?: string): Promise<T> {
  const entry: Extract<ProgressEntry, { type: 'agent' }> = {
    type: 'agent', subtype, stage_id: stageId, timestamp: new Date().toISOString(), ...(role ? { role } : {}),
  };
  record.progress.push(entry);
  save(record, file);
  const started = performance.now();
  try {
    return await action();
  } finally {
    entry.duration_ms = performance.now() - started;
    save(record, file);
  }
}
