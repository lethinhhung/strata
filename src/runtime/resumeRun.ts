import { RunError } from './types.js';
import { executeRun } from './executeRun.js';
import { loadRun } from './loadRun.js';
import * as utils from './utils.js';
import * as path from 'node:path';

export async function resumeRun(repo: string, runFile: string, config: any, onProgress?: (entry: any) => void) {
    const file = path.isAbsolute(runFile) ? runFile : path.resolve(repo, runFile);
    const record = loadRun(file);
    if (onProgress) Object.defineProperty(record, 'onProgress', { value: onProgress, configurable: true });
    // Ensure progress field exists for backward compatibility
    if (!('progress' in record) || !Array.isArray(record.progress)) {
      record.progress = [];
    }
    if (record.status === 'complete') return record;
    if (!['planned', 'failed', 'running'].includes(record.status)) throw new RunError(`Run with status ${record.status} cannot be resumed`);
    for (const stage of record.stages) if (stage.status === 'in_progress' || stage.status === 'failed') stage.status = 'pending';
    for (const stage of record.stages) if (stage.status === 'in_progress' || stage.status === 'failed') {
      record.progress.push({ type: 'stage', subtype: 'pending', stage_id: stage.id, timestamp: utils.now() });
    }
    record.progress.push({ type: 'run', subtype: 'resume', timestamp: utils.now() });
    utils.save(record, file);
    try {
      await executeRun(repo, record, config, file);
    } catch (error) {
      if (record.status !== 'complete') {
        record.status = 'failed';
        const previous = record.failure;
        if (previous) record.failure_history = [...(record.failure_history ?? []), previous];
        record.failure = { message: error instanceof Error ? error.message : String(error), timestamp: utils.now(), stage_id: record.stages.find((stage: any) => stage.status === 'failed')?.id };
        record.progress.push({ type: 'run', subtype: 'fail', timestamp: utils.now() });
        record.updated_at = utils.now();
        utils.save(record, file);
      }
      throw error;
    }
    return record;
  }
