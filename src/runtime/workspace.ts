import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

const generatedDirectories = new Set(['.git', 'node_modules', '.expo', '.turbo', 'Pods', '.gradle', 'coverage']);

export function isGeneratedWorkspacePath(relative: string) {
  return relative.split(/[\\/]/).some((part) => generatedDirectories.has(part));
}

export function copyWorkspace(source: string, destination: string) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter(item) {
      const relative = path.relative(source, item);
      if (!relative) return true;
      if (isGeneratedWorkspacePath(relative)) return false;
      return true;
    },
  });
}

export function restoreWorkspacePaths(source: string, destination: string, paths: string[]) {
  const ordered = [...paths].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  for (const relative of ordered) {
    const backup = path.join(source, relative);
    const target = path.join(destination, relative);
    if (!ensureSafeParent(destination, relative)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    const stat = fs.lstatSync(backup, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(backup), target);
    else if (stat.isDirectory()) fs.mkdirSync(target, { recursive: true });
    else {
      fs.copyFileSync(backup, target);
      fs.chmodSync(target, stat.mode & 0o777);
    }
  }
}

function ensureSafeParent(root: string, relative: string) {
  let current = root;
  const parents = path.dirname(relative).split(path.sep).filter((part) => part && part !== '.');
  for (const part of parents) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink() || stat && !stat.isDirectory()) return false;
    if (!stat) fs.mkdirSync(current);
  }
  return true;
}

export function workspaceFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (!isGeneratedWorkspacePath(relative)) visit(full);
      } else if (entry.isSymbolicLink()) {
        files.set(relative, 'symlink');
      } else if (entry.isFile()) {
        const mode = fs.statSync(full).mode & 0o111;
        const hash = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        files.set(relative, `${mode}:${hash}`);
      }
    }
  }
  visit(root);
  return files;
}
