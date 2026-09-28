import { RunError } from './types.js';
import { executeRun } from './executeRun.js';
import { loadRun } from './loadRun.js';
import path from 'node:path';

export async function resumeRun(repo: string, runFile: string, config: any) {
  const file = path.isAbsolute(runFile) ? runFile : path.resolve(repo, runFile);
  const record = loadRun(file);
  if (record.status === 'complete') return record;
  if (!['planned', 'failed', 'running'].includes(record.status)) throw new RunError(`Run with status ${record.status} cannot be resumed`);
  for (const stage of record.stages) if (stage.status === 'in_progress' || stage.status === 'failed') stage.status = 'pending';
  delete record.failure;
  await executeRun(repo, record, config, file);
  return record;
}
