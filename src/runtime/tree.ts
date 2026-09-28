import fs from 'node:fs';
import path from 'node:path';

function readTree(repo: string, specPaths: string[], limit = 32_000): string {
  const chunks: string[] = [];
  let length = 0;
  for (const item of specPaths) {
    const full = path.resolve(repo, item);
    if (!full.startsWith(`${path.resolve(repo)}${path.sep}`) || !fs.existsSync(full)) continue;
    const files = fs.statSync(full).isFile() ? [full] : walk(full);
    for (const file of files) {
      try {
        const body = fs.readFileSync(file, 'utf8');
        if (body.includes('\u0000')) continue;
        const relative = path.relative(repo, file);
        const chunk = `\n--- ${relative} ---\n${body}\n`;
        if (length + chunk.length > limit) return `${chunks.join('')}\n[Context truncated at ${limit} characters.]`;
        chunks.push(chunk);
        length += chunk.length;
      } catch { /* Unreadable and binary files are not prompt context. */ }
    }
  }
  return chunks.join('');
}

function walk(directory: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

export { readTree, walk };