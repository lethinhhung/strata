import { readFileSync } from 'node:fs';
import { RunError, RunRecord } from './types.js';

export function loadRun(file: string): RunRecord {
   const contents = readFileSync(file, 'utf8');
   const fenced = contents.match(/```json\s*([\s\S]*?)```/i);
   const record = JSON.parse(fenced?.[1] ?? contents);
   if (record.schema_version !== 1) throw new RunError(`Unsupported run record version: ${file}`);
   // Ensure progress field exists for backward compatibility
   if (!('progress' in record) || !Array.isArray(record.progress)) {
     record.progress = [];
   }
   // Ensure all required fields exist for backward compatibility
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
   return record;
 }
