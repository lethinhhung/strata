import * as utils from './utils.js';
import * as helpers from './helpers.js';
import { RunError } from './types.js';
import { inScope } from './helpers.js';

export function checkpoint(repo: string, stage: any, config: any, record: any, file: string, attempt: number) {
  const changed = utils.changes(new Map(), utils.runSnapshot(repo, record, file));
  const eligible = changed.filter((filePath: string) => !filePath.startsWith('specs/') && !filePath.startsWith('docs/temps/'));
  const unrelated = eligible.filter((filePath: string) => !inScope(filePath, stage.scope ?? []));
  if (unrelated.length) throw new RunError(`Checkpoint for ${stage.id} has changes outside stage scope: ${unrelated.join(', ')}`);
  if (config.workflow.checkpoint) {
    if (!eligible.length && !stage.checkpoint_commit) throw new RunError(`No files to checkpoint for stage ${stage.id}`);
    if (eligible.length) {
      const staged = utils.git(repo, ['diff', '--cached', '--name-only', '--', ...eligible]).stdout
        .split('\n').map((filePath: string) => filePath.trim()).filter(Boolean);
      if (staged.length) throw new RunError(`Checkpoint for ${stage.id} refuses pre-staged in-scope paths: ${staged.join(', ')}`);
      const add = utils.git(repo, ['add', '-A', '--', ...eligible], { allowFailure: true });
      if (add.status !== 0) throw new RunError(add.stderr.trim());
      const message = `${config.workflow.checkpoint_prefix}: ${stage.id} ${stage.title} [${stage.checkpoint}]${attempt > 1 ? ` repair-${attempt}` : ''}`;
      const commit = utils.git(repo, ['commit', '--only', '-m', message, '--', ...eligible], { allowFailure: true });
      if (commit.status !== 0) throw new RunError(`Checkpoint failed for ${stage.id}: ${commit.stderr.trim()}`);
      stage.checkpoint_commit = utils.git(repo, ['rev-parse', 'HEAD']).stdout.trim();
    }
  }
  stage.status = 'complete';
  delete stage.failure;
  stage.completed_at = utils.now();
  utils.save(record, file);
}
