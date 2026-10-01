import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { RunError } from './types.js';
import { isGeneratedWorkspacePath } from './workspace.js';

export function git(repo: string, args: string[], { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw new RunError(`Could not run git: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) throw new RunError((result.stderr || `git ${args.join(' ')} failed`).trim());
  return result;
}

export function snapshot(repo: string, excludedPaths: string[]) {
  const excluded = new Set(excludedPaths.map((item) => path.resolve(item)));
  // Enumerate untracked files individually so edits inside an untracked
  // directory change the snapshot fingerprint, not just its directory row.
  const output = git(repo, ['status', '--porcelain=v1', '--untracked-files=all', '-z']).stdout;
  const rows = output.split('\0');
  const files = new Map<string, string>();
  for (let i = 0; i < rows.length && rows[i]; i += 1) {
    const row = rows[i];
    const file = row.slice(3);
    if (isGeneratedWorkspacePath(file)) continue;
    if (excluded.has(path.resolve(repo, file))) continue;
    if (file.startsWith(`docs${path.sep}temps${path.sep}`) && fs.existsSync(path.resolve(repo, file))) {
      try {
        if (fs.readFileSync(path.resolve(repo, file), 'utf8').startsWith('# Strata run ')) continue;
      } catch { /* Keep unreadable paths visible as worktree changes. */ }
    }
    const absolute = path.resolve(repo, file);
    let fingerprint = 'missing';
    try {
      const stat = fs.lstatSync(absolute);
      if (stat.isFile()) fingerprint = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      else if (stat.isSymbolicLink()) fingerprint = `symlink:${fs.readlinkSync(absolute)}`;
    } catch { /* A missing path remains represented by its Git status. */ }
    files.set(file, `${row.slice(0, 2)}:${fingerprint}`);
    if (row[0] === 'R' || row[1] === 'R' || row[0] === 'C' || row[1] === 'C') i += 1;
  }
  return files;
}

export function runSnapshot(repo: string, record: any, file: string) {
  const excluded = [file, record.config, record.epic_absolute_path].filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
  return snapshot(repo, excluded);
}
