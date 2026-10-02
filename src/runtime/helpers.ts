import { git, now } from './utils.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

export function stageContract(stage: any) {
  return Object.fromEntries(['id', 'title', 'kind', 'mechanical', 'concern', 'scope', 'accepted_paths', 'dependencies', 'completion_criteria', 'checkpoint'].map((key) => [key, stage[key]]));
}

export function inScope(file: string, scopes: string[]) {
  return scopes.some((scope) => {
    const normalized = scope.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized === file || file.startsWith(`${normalized}/`)) return true;
    const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]?').replace(/\u0000/g, '.*');
    return new RegExp(`^${escaped}$`).test(file);
  });
}

export function isTestPath(file: string) {
  const value = file.toLowerCase();
  const name = path.posix.basename(value);
  return value.startsWith('test/') || value.includes('/test/') || value.includes('/tests/') ||
    value.includes('/__tests__/') || name.startsWith('test_') || name.endsWith('_test.py') ||
    /\.(test|spec)\.[^.]+$/.test(name) || name === 'test' || name === 'tests';
}

export function reviewDiff(repo: string, files: string[], checkpointCommit: string | null) {
  const tracked = git(repo, ['diff', 'HEAD', '--', ...files]).stdout;
  const checkpointed = checkpointCommit
    ? git(repo, ['show', '--format=', checkpointCommit, '--', ...files]).stdout
    : '';
  const untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).stdout
    .split('\0').filter((file) => file && files.includes(file));
  const additions = untracked.map((file) => {
    let content;
    try { content = fs.readFileSync(path.join(repo, file), 'utf8'); }
    catch { content = '[binary or unreadable file]'; }
    return `\n--- /dev/null\n+++ b/${file}\n${content.split('\n').map((line) => `+${line}`).join('\n')}\n`;
  }).join('\n');
  return `${tracked}\n${checkpointed}\n${additions}`;
}

export function addPhase(stage: any, phase: string, result: any, extra: any = {}) {
  stage.phase_results.push({ phase, result, at: now(), ...extra });
}
