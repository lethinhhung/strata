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
     const result = await action();
// Extract telemetry from result if present
      if (result && typeof result === 'object') {
        if ('model' in result && typeof result.model === 'string') {
          entry.model = result.model;
        }
        if ('prompt_tokens' in result && typeof result.prompt_tokens === 'number') {
          entry.prompt_tokens = result.prompt_tokens;
        }
        if ('completion_tokens' in result && typeof result.completion_tokens === 'number') {
          entry.completion_tokens = result.completion_tokens;
        }
        if ('total_tokens' in result && typeof result.total_tokens === 'number') {
          entry.total_tokens = result.total_tokens;
        }
      }
     return result;
   } finally {
     entry.duration_ms = performance.now() - started;
     save(record, file);
     const listener = record.onProgress as ((progress: ProgressEntry) => void) | undefined;
     listener?.({ ...entry });
   }
}
