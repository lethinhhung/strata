import * as utils from './utils.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { RunError, RunRecord } from './types.js';

export async function archiveMemory(repo: string, record: any, config: any) {
   // Ensure record has all required fields
   if (!('progress' in record) || !Array.isArray(record.progress)) {
     record.progress = [];
   }
   // Record archive agent transition
   record.progress.push({ type: 'agent', subtype: 'archive', stage_id: 'epic', timestamp: utils.now() });
const defaultRecord: Partial<RunRecord> = {
     created_at: '',
     repository: '',
     epic: '',
     epic_path: '',
     epic_absolute_path: '',
     config: { worker:{}, strong:{}, workflow:{ max_repairs:0, review_repair_attempts:0, test_repair_attempts:0, validation_repair_attempts:0, checkpoint:false, checkpoint_prefix:'', spec_paths:[], memory_path:'', memory_policy:'', test_commands:[], quality_checks:[], setup_commands:[], require_agent_gates:true }, path:undefined },
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
       (record as any)[key] = defaultRecord[key as keyof Partial<RunRecord>];
     }
   });
  // Now record is guaranteed to have all fields of RunRecord
  const current = utils.readTree(repo, [config.workflow.memory_path], 12_000);
  const result = await utils.askReadOnly(config, 'Archivist', {
    repo,
    shape: '{"entries":[{"class":"decision|note|progress","content":"..."}]}',
    text: `This run succeeded. Review it and current memory; propose only observed reusable engineering knowledge, check duplicates, and never include credentials, secrets, private content, or raw application data. Do not write specs, tests, or source. Include date, affected paths, and run id in entries.\nRUN:\n${utils.json(record)}\nCURRENT MEMORY:\n${current}`,
  }, current, { strong: true });
  const entries = Array.isArray(result.entries) ? result.entries : [];
  if (!entries.length) return { status: 'complete', entries: 0 };
  const directory = path.resolve(repo, config.workflow.memory_path);
  if (!directory.startsWith(`${path.resolve(repo)}${path.sep}`)) throw new RunError('Configured memory path must remain inside the repository');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, 'archive.md');
  for (const entry of entries) {
    if (!entry?.content || !['decision', 'note', 'progress'].includes(entry.class)) continue;
    if (/(api[_ -]?key|secret|password|token)\s*[:=]\s*\S+/i.test(entry.content)) continue;
    if (current.includes(entry.content)) continue;
    fs.appendFileSync(target, `\n## ${entry.class[0].toUpperCase()}${entry.class.slice(1)} — ${utils.now().slice(0, 10)}\n\n${entry.content}\n`, 'utf8');
  }
  return { status: 'complete', entries: entries.length, path: path.relative(repo, target) };
}
