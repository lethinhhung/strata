import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

const generatedDirectories = new Set(['.git', 'node_modules', '.expo', '.turbo', 'Pods', '.gradle', 'coverage']);

export function copyWorkspace(source: string, destination: string) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter(item) {
      const relative = path.relative(source, item);
      if (!relative) return true;
      if (relative.split(path.sep).some((part) => generatedDirectories.has(part))) return false;
      try { return !fs.lstatSync(item).isSymbolicLink(); }
      catch { return false; }
    },
  });
}

export function workspaceFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (!generatedDirectories.has(entry.name)) visit(full);
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