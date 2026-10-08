import type { ProgressEntry, StageTransition } from './runtime/types.js';

export function formatProgress(entry: ProgressEntry): string {
   const time = new Date(entry.timestamp).toLocaleTimeString();
   if (entry.type === 'run') return `[${time}] run: ${entry.subtype}`;
   if (entry.type === 'stage') return `[${time}] stage ${entry.stage_id}: ${entry.subtype}`;
   if (entry.type === 'agent') {
      let msg = `[${time}] agent ${entry.role ?? entry.subtype} (stage ${entry.stage_id})`;
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
};

import { fmtTime } from './progress-reporter.js';

export { createProgressReporter } from './progress-reporter.js';



export function formatFailure(error: unknown) {
    return `strata: ${error instanceof Error ? error.message : String(error)}`;
}

export function formatCompletionSummary(ac:'run'|'resume',r:any):string {
    const id = r.run_id;
    const {status, stages, progress, final_validation} = r;
    const stRun = progress.find((p: ProgressEntry)=>p.type==='run'&&(p.subtype==='start'||p.subtype==='resume'));
    const enRun = progress.find((p: ProgressEntry)=>p.type==='run'&&(p.subtype==='complete'||p.subtype==='fail'));
    const elap = stRun && enRun ? Date.parse(enRun.timestamp)-Date.parse(stRun.timestamp) : 0;
    const compl = stages.filter((s: StageTransition)=>s.subtype==='complete').length;
    const agt = progress.filter((p: ProgressEntry)=>p.type==='agent').length;
    const retMap = new Map<string,number>();
    for (const p of progress) if (p.type==='agent') {
        const k = `${p.stage_id}:${p.role??''}:${p.subtype}`;
        retMap.set(k, (retMap.get(k)||0)+1);
    }
    const ret = [...retMap.values()].reduce((sum:number,v:number)=>sum+(v>1?v-1:0),0);
    const tok = progress.reduce((sum:number,p:any)=>sum+(p.type==='agent'&&p.total_tokens!==undefined?p.total_tokens:0),0);
    const val = final_validation ? ` — validation: ${final_validation.result.status} (${final_validation.observed_changed_paths?.length??0} ch)` : '';
    return `${ac} ${id}: ${status} — elapsed ${fmtTime(elap)} — stages comp ${compl}/${stages.length} — agts ${agt} — ret ${ret} — tok ${tok}${val}`;
}
