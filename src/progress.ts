import type { ProgressEntry } from './runtime/types.js';

export function formatProgress(entry: ProgressEntry): string {
   const time = new Date(entry.timestamp).toLocaleTimeString();
   if (entry.type === 'run') return `[${time}] run: ${entry.subtype}`;
   if (entry.type === 'stage') return `[${time}] stage ${entry.stage_id}: ${entry.subtype}`;
   if (entry.type === 'agent') {
      let msg = `[${time}] agent ${entry.subtype} (stage ${entry.stage_id})`;
      if (entry.duration_ms !== undefined) {
         const seconds = (entry.duration_ms / 1000).toFixed(1);
         msg += ` — ${seconds}s`;
      }
      return msg;
   }
   const result = entry.passed ? 'pass' : 'fail';
   return `[${time}] gate ${entry.subtype} (stage ${entry.stage_id}): ${result}`;
}

export function printProgress(entry: ProgressEntry): void {
  console.log(formatProgress(entry));
}

export function formatOutcome(action: 'run' | 'resume', record: { run_id: string; status: string }, reference: string) {
  return `${action} ${record.run_id}: ${record.status} — ${reference}`;
}

export function formatFailure(error: unknown) {
  return `strata: ${error instanceof Error ? error.message : String(error)}`;
}
