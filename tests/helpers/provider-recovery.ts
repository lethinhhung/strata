import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Creates a temporary directory for a test repository.
 */
export function createTempRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'recovery-'));
  return dir;
}

/**
 * Writes the fixture provider script to the given directory.
 * The script is executable and contains the logic from the original JS fixture.
 */
export function writeFixtureProvider(
  repoPath: string,
  scriptPath: string = 'fixture-provider.js',
  content: string
): string {
  const fullPath = path.join(repoPath, scriptPath);
  writeFileSync(fullPath, content, { mode: 0o755 });
  return fullPath;
}

/**
 * Cleans up the temporary repository directory.
 */
export function cleanupRepo(repoPath: string): void {
  if (existsSync(repoPath)) {
    rmSync(repoPath, { recursive: true, force: true });
  }
}

