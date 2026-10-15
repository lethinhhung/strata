import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { StrataConfig } from '../config.js';
import { invoke, run } from '../provider.js';

type WorkspaceFile = { kind: 'file' | 'symlink'; contents: Buffer; mode: number };
type WorkspaceSnapshot = { files: Map<string, WorkspaceFile>; indexPath: string; index?: Buffer; fingerprint: string };

export class ReadOnlyMutationError extends Error {}

export async function invokeReadOnly(agent: StrataConfig['worker'] | StrataConfig['strong'], prompt: string, repo: string): Promise<string> {
  const before = await snapshotWorkspace(repo);
  let response = '';
  let failure: unknown;
  let rejected = false;
  try { response = await invoke(agent, prompt, repo, true); }
  catch (error) { rejected = true; failure = error; }
  const after = await snapshotWorkspace(repo);
  if (before.fingerprint !== after.fingerprint) {
    await restoreWorkspace(repo, before, after);
    throw new ReadOnlyMutationError('A read-only workflow agent changed the target worktree; its changes were reverted.');
  }
  if (rejected) throw failure;
  return response;
}

async function snapshotWorkspace(repo: string): Promise<WorkspaceSnapshot> {
  const listed = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], repo, 10000);
  const files = new Map<string, WorkspaceFile>();
  for (const relative of listed.stdout.split('\0').filter(Boolean)) {
    const full = path.join(repo, relative);
    try {
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) files.set(relative, { kind: 'symlink', contents: Buffer.from(fs.readlinkSync(full)), mode: stat.mode & 0o777 });
      else if (stat.isFile()) files.set(relative, { kind: 'file', contents: fs.readFileSync(full), mode: stat.mode & 0o777 });
    } catch { /* ignore files disappearing during enumeration */ }
  }
  const indexResult = await run('git', ['rev-parse', '--git-path', 'index'], repo, 10000);
  const indexPath = path.resolve(repo, indexResult.stdout.trim());
  let index: Buffer | undefined;
  try { index = fs.readFileSync(indexPath); } catch { /* repository may not have an index yet */ }
  return { files, indexPath, index, fingerprint: fingerprintWorkspace(files, index) };
}

function fingerprintWorkspace(files: Map<string, WorkspaceFile>, index?: Buffer): string {
  const hash = createHash('sha256');
  for (const [file, state] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(file).update(state.kind).update(String(state.mode)).update(state.contents);
  }
  if (index) hash.update(index);
  return hash.digest('hex');
}

async function restoreWorkspace(repo: string, before: WorkspaceSnapshot, after: WorkspaceSnapshot): Promise<void> {
  for (const relative of after.files.keys()) {
    if (!before.files.has(relative)) try { fs.unlinkSync(path.join(repo, relative)); } catch { /* already removed */ }
  }
  for (const [relative, state] of before.files) {
    const full = path.join(repo, relative);
    const current = after.files.get(relative);
    if (current && current.kind === state.kind && current.mode === state.mode && current.contents.equals(state.contents)) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    try { fs.rmSync(full, { force: true }); } catch { /* recreate below */ }
    if (state.kind === 'symlink') fs.symlinkSync(state.contents.toString(), full);
    else { fs.writeFileSync(full, state.contents); fs.chmodSync(full, state.mode); }
  }
  if (before.index) {
    fs.mkdirSync(path.dirname(before.indexPath), { recursive: true });
    fs.writeFileSync(before.indexPath, before.index);
  } else if (after.index) try { fs.unlinkSync(before.indexPath); } catch { /* index already absent */ }
}
