import * as fs from 'node:fs';
import * as path from 'node:path';
import { RunRecord } from './types.js';

export function save(record: any, file: string) {
  // Ensure record has all required fields
  if (!('progress' in record) || !Array.isArray(record.progress)) {
    record.progress = [];
  }
const defaultRecord: Partial<RunRecord> = {
      created_at: '',
      repository: '',
      epic: '',
      epic_path: '',
      epic_absolute_path: '',
      config: { worker:{}, strong:{}, workflow:{ max_repairs:0, checkpoint:false, checkpoint_prefix:'', spec_paths:[], memory_path:'', test_commands:[], quality_checks:[], }, path:undefined },
      memory_consulted: { paths:[], excerpt:'' },
      plan: undefined,
      updated_at: undefined,
      final_review: undefined,
      final_validation: undefined,
      final_evidence: undefined,
      final_validated_at: undefined,
      epic_checkpoint: undefined,
      completed_at: undefined,
      failure: undefined,
    };
(Object.keys(defaultRecord) as (keyof RunRecord)[]).forEach(key => {
     if (!(key in record)) {
       (record as any)[key] = defaultRecord[key];
     }
   });
  // Now record is guaranteed to have all fields of RunRecord
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  const body = `# Strata run ${record.run_id}\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
  fs.writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  const listener = record.onProgress as ((entry: any) => void) | undefined;
  const sent = (record.progress_sent as number | undefined) ?? 0;
  if (listener) {
    for (const entry of record.progress.slice(sent)) listener(entry);
    Object.defineProperty(record, 'progress_sent', { value: record.progress.length, writable: true, configurable: true });
  }
}
