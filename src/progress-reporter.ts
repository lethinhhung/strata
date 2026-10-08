export const fmtTime = (ms: number) => {
    const s = Math.max(0, Math.floor(ms/1000));
    const h = Math.floor(s/3600);
    const m = Math.floor((s%3600)/60);
    const sec = s%60;
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
};

type ProgressReporter = {
   print: (entry: ProgressEntry) => void;
   finish: () => void;
};

import type { ProgressEntry, AgentTransition, StageTransition } from './runtime/types.js';
import { formatProgress } from './progress.js';

export function createProgressReporter(isTTY = process.stdout.isTTY): ProgressReporter {
    let rs: number|undefined;
    const aa = new Map<string,number>();
    const as = new Map<string,number>();
    const ai = new Map<string,AgentTransition>();
    const al = new Map<string,AgentTransition>();
    let totalTokens = 0;
    let ls: StageTransition|undefined;
    const cl = () => process.stdout.write('\r\x1b[2K');
    const re = () => {
        if (!isTTY || rs===undefined) return;
        const now = Date.now();
        const rt = fmtTime(now - rs);
        const st = ls ? {id:ls.stage_id, subt:ls.subtype} : undefined;
        let ag: {role:string;att:number;d?:number|undefined;t?:number|undefined;m?:string|undefined}|undefined;
        let k: string|undefined;
        if (as.size>0) {
            let lt=0;
            for (const [kk,st] of as.entries()) if (st>lt) { lt=st; k=kk; }
        }
        if (!k && al.size>0) {
            let lt2=0;
            for (const [kk,ent] of al.entries()) { 
                const tm=Date.parse(ent.timestamp);
                if (tm>lt2) { lt2=tm; k=kk; } 
            }
        }
        if (k) {
            let ent = al.get(k);
            if (!ent) {
                ent = ai.get(k);
            }
            if (ent) {
                const att = aa.get(k)||1;
                const role = ent.role??ent.subtype;
                const dur = ent.duration_ms!==undefined ? ent.duration_ms/1000 : undefined;
                const tok = ent.total_tokens;
                const mod = ent.model;
                ag = {role,att,d:dur,t:tok,m:mod};
            }
        }
        let line = `\r\x1b[2K[${new Date().toLocaleTimeString()}] `;
        line += st ? `stage ${st.id} (${st.subt}): ` : 'stage unknown: ';
        if (ag) {
            line += `agent ${ag.role} (att ${ag.att}) [retries ${Math.max(0, ag.att - 1)}]`;
            if (ag.d!==undefined) line += ` — ${ag.d.toFixed(1)}s`;
            if (ag.t!==undefined) line += ` — ${ag.t}tok`;
            if (ag.m!==undefined) line += ` — ${ag.m}`;
        } else line += 'agent unknown';
        let totalRetries = 0;
        for (const [,attempt] of aa.entries()) if (attempt > 1) totalRetries += attempt - 1;
        line += ` | retries: ${totalRetries} | tokens: ${totalTokens} | elapsed: ${rt}`;
        process.stdout.write(line);
    };
    return {
            print(e) {
            if (e.type==='run' && (e.subtype==='start'||e.subtype==='resume')) {
                rs = Date.parse(e.timestamp);
                if (!Number.isFinite(rs)) rs = Date.now();
            }
            if (e.type==='stage') ls = e as StageTransition;
            if (e.type==='agent') {
                const ae = e as AgentTransition;
                totalTokens += ae.total_tokens ?? 0;
                const k = `${ae.stage_id}:${ae.role??''}:${ae.subtype}`;
                // Increment the attempt count for this agent key
                const c = aa.get(k)||0;
                aa.set(k,c+1);
                if (ae.duration_ms===undefined) {
                    as.set(k,Date.parse(e.timestamp));
                    ai.set(k,ae);
                } else {
                    as.delete(k);
                    ai.delete(k);
                    al.set(k,ae);
                }
            }
            if (!isTTY) { console.log(formatProgress(e)); return; }
            cl(); re();
        },
        finish() { cl(); process.stdout.write('\n'); }
    };
}
