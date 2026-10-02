import * as utils from './utils.js';
import { archiveMemory } from './archiveMemory.js';

export async function archiveStageMemory(repo: string, record: any, stage: any, config: any, file: string) {
  if (stage.archival?.status === 'complete') return;
  try {
    const result = await archiveMemory(repo, record, config, file, stage.id);
    if (result.path) {
      stage.accepted_paths = [...new Set([...(stage.accepted_paths ?? []), ...result.path.split(', ').filter(Boolean)])];
      utils.save(record, file);
    }
  } catch (error) {
    stage.archival = {
      status: 'failed', entries: 0,
      error: error instanceof Error ? error.message : String(error),
    };
    utils.save(record, file);
  }
}
