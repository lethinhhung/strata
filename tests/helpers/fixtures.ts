import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, afterEach, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';

const resources: string[] = [];
const suiteResources: string[] = [];
export function temporaryDirectory(suite = false): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'strata-regression-')));
  (suite ? suiteResources : resources).push(root);
  return root;
}

export function write(repo: string, relative: string, contents: string): void {
  const file = path.join(repo, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

export function git(repo: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

export function repository(): { repo: string; remote: string } {
  const root = temporaryDirectory();
  const repo = path.join(root, 'repo');
  const remote = path.join(root, 'remote.git');
  fs.mkdirSync(repo);
  const hooks = path.join(root, 'empty-hooks');
  const template = path.join(root, 'empty-template');
  fs.mkdirSync(hooks);
  fs.mkdirSync(template);
  const globalConfig = path.join(root, 'gitconfig');
  fs.writeFileSync(globalConfig, '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_TERMINAL_PROMPT', '0');
  vi.stubEnv('GIT_TEMPLATE_DIR', template);
  for (const key of Object.keys(process.env)) {
    if (/^GIT_(?:CONFIG(?:_(?:PARAMETERS|COUNT|KEY_\d+|VALUE_\d+))?|DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|AUTHOR_.*|COMMITTER_.*)$/.test(key)) vi.stubEnv(key, undefined);
  }
  git(repo, 'init', '-b', 'work');
  git(repo, 'config', 'user.name', 'Strata Test');
  git(repo, 'config', 'user.email', 'strata@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'tag.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', hooks);
  git(repo, 'config', 'protocol.file.allow', 'always');
  write(repo, 'README.md', 'Disposable regression repository.\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'fixture');
  git(repo, 'init', '--bare', remote);
  git(remote, 'config', 'core.hooksPath', hooks);
  git(repo, 'remote', 'add', 'origin', remote);
  return { repo, remote };
}

export function configuration(repo: string) {
  const config = loadConfig(repo);
  // Both roles use the same substitute; process-failure cases cannot fall back to a real provider.
  config.strong = { ...config.strong, command: 'scripted-provider' };
  config.worker = { ...config.strong };
  return config;
}

export function savedRun(repo: string) {
  const directory = path.join(repo, 'docs', 'temps');
  const files = fs.readdirSync(directory).filter((file) => file.endsWith('.json'));
  if (files.length !== 1) throw new Error(`Expected one saved run, found ${files.length}`);
  return JSON.parse(fs.readFileSync(path.join(directory, files[0]), 'utf8'));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of resources.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  for (const root of suiteResources.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
