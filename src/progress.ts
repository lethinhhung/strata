import type { ProgressEntry } from './runtime/types.js';

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
}

type ProgressReporter = {
  print: (entry: ProgressEntry) => void;
  finish: () => void;
};

/** Print normal progress events while keeping a live elapsed-time line in a TTY. */
export function createProgressReporter(isTTY = process.stdout.isTTY): ProgressReporter {
  let runStartedAt: number | undefined;
  let stepStartedAt: number | undefined;
  let stepName: string | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let tickerVisible = false;

  const clearTicker = () => {
    if (!tickerVisible) return;
    process.stdout.write('\r\x1b[2K');
    tickerVisible = false;
  };

  const renderTicker = () => {
    if (!isTTY || runStartedAt === undefined) return;
    const now = Date.now();
    const runTime = formatElapsed(now - runStartedAt);
    const stepTime = stepStartedAt === undefined ? undefined : formatElapsed(now - stepStartedAt);
    const step = stepName && stepTime ? `Stage ${stepName} ${stepTime} | ` : '';
    process.stdout.write(`\r\x1b[2K⏱ ${step}Total ${runTime}`);
    tickerVisible = true;
  };

  return {
    print(entry) {
      if (entry.type === 'run' && (entry.subtype === 'start' || entry.subtype === 'resume')) {
        runStartedAt = Date.parse(entry.timestamp);
        if (!Number.isFinite(runStartedAt)) runStartedAt = Date.now();
      }
      if (entry.type === 'stage') {
        if (entry.subtype === 'in_progress') {
          stepName = 'starting';
          stepStartedAt = Date.parse(entry.timestamp);
          if (!Number.isFinite(stepStartedAt)) stepStartedAt = Date.now();
        } else if (entry.subtype === 'complete' || entry.subtype === 'fail' || entry.subtype === 'skip') {
          stepName = undefined;
          stepStartedAt = undefined;
        }
      } else if (entry.type === 'agent' || entry.type === 'gate') {
        stepName = entry.type === 'agent'
          ? (entry.role ?? entry.subtype).replace(/\s+Agent$/i, '').toLowerCase()
          : entry.subtype;
        stepStartedAt = Date.parse(entry.timestamp);
        if (!Number.isFinite(stepStartedAt)) stepStartedAt = Date.now();
      }

      clearTicker();
      if (isTTY) process.stdout.write(`${formatProgress(entry)}\n`);
      else console.log(formatProgress(entry));

      if (isTTY && (entry.type === 'run' || entry.type === 'stage' || entry.type === 'agent' || entry.type === 'gate')) {
        if (!interval && runStartedAt !== undefined) interval = setInterval(renderTicker, 1000);
        renderTicker();
      }
    },
    finish() {
      if (interval) clearInterval(interval);
      interval = undefined;
      clearTicker();
    },
  };
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatOutcome(action: 'run' | 'resume', record: { run_id: string; status: string }, reference: string) {
  const detailed = record as typeof record & { stages?: Array<{ checkpoint_commit?: string; pushed?: boolean; open_issues?: string[] }> };
  const stages = detailed.stages ?? [];
  const committed = stages.filter((stage) => stage.checkpoint_commit).length;
  const pushed = stages.filter((stage) => stage.pushed).length;
  const openIssues = stages.reduce((sum, stage) => sum + (stage.open_issues?.length ?? 0), 0);
  const caveats = [committed ? `stages committed ${committed}/${stages.length}, pushed ${pushed}/${committed}` : '', openIssues ? `${openIssues} unresolved gate finding(s)` : ''].filter(Boolean);
  return `${action} ${record.run_id}: ${record.status}${caveats.length ? ` — ${caveats.join('; ')}` : ''} — ${reference}`;
}

export function formatFailure(error: unknown) {
  return `strata: ${error instanceof Error ? error.message : String(error)}`;
}
