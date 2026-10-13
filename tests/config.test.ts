import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, initConfig, loadConfig } from '../src/config.js';
import { temporaryDirectory, write } from './helpers/fixtures.js';

describe('configuration', () => {
  it('loads built-in and generated defaults', () => {
    const repo = temporaryDirectory();
    const defaults = loadConfig(repo);
    expect(defaults.strong).toEqual({ provider: 'codex', model: '', command: 'codex', timeout_seconds: 3600, idle_timeout_seconds: 0, extra_args: [] });
    expect(defaults.worker).toEqual({ provider: 'opencode', model: 'nvidia/openai/gpt-oss-20b', command: 'opencode', timeout_seconds: 1800, idle_timeout_seconds: 360, extra_args: [] });
    expect(defaults.workflow).toEqual({ implement_fix_attempts: 3, spec_paths: ['specs', 'AGENTS.md', 'RULES.md'], memory_path: 'memory', checks: [] });
    expect(initConfig(repo)).toBe(path.join(repo, '.strata.toml'));
    expect(fs.readFileSync(path.join(repo, '.strata.toml'), 'utf8')).toBe(DEFAULT_CONFIG);
    expect(loadConfig(repo)).toEqual(defaults);
  });

  it('loads provider and workflow overrides through relative and absolute explicit paths', () => {
    const repo = temporaryDirectory();
    write(repo, 'custom.toml', `[models.strong]\nprovider="opencode"\nmodel="fixture"\ncommand="local"\ntimeout_seconds=12\nextra_args=["--flag"]\n[workflow]\nimplement_fix_attempts=2\nspec_paths=["RULES.md"]\nmemory_path="notes"\nchecks=[["node", "check.js"]]\n`);
    const config = loadConfig(repo, 'custom.toml');
    expect(config.strong).toEqual({ provider: 'opencode', model: 'fixture', command: 'local', timeout_seconds: 12, idle_timeout_seconds: 360, extra_args: ['--flag'] });
    expect(config.worker.model).toBe(''); // Partial TOML uses the fallback, not the generated model.
    expect(config.workflow).toEqual({ implement_fix_attempts: 2, spec_paths: ['RULES.md'], memory_path: 'notes', checks: [['node', 'check.js']] });
    expect(loadConfig(repo, path.join(repo, 'custom.toml'))).toEqual(config);
    expect(loadConfig(repo, 'missing.toml').worker.model).toBe('nvidia/openai/gpt-oss-20b');
  });

  it.each([
    ['[broken', /./],
    ['[models.strong]\nprovider="unsupported"', /Unsupported provider/],
    ['[models.worker]\nprovider="unsupported"', /Unsupported provider/],
    ...['0', '-1', '1.5', '"wrong"'].map((value) => [`[workflow]\nimplement_fix_attempts=${value}`, /positive integer/]),
    ...['"bad"', '[[]]', '[[1]]', '["node"]'].map((value) => [`[workflow]\nchecks=${value}`, /non-empty command arrays/]),
  ])('rejects invalid configuration %s', (contents, error) => {
    const repo = temporaryDirectory();
    write(repo, '.strata.toml', String(contents));
    expect(() => loadConfig(repo)).toThrow(error as RegExp);
  });

  it('protects existing bytes and permits forced replacement', () => {
    const repo = temporaryDirectory();
    write(repo, '.strata.toml', 'original bytes\n');
    expect(() => initConfig(repo)).toThrow(/already exists/);
    expect(fs.readFileSync(path.join(repo, '.strata.toml'), 'utf8')).toBe('original bytes\n');
    initConfig(repo, true);
    expect(fs.readFileSync(path.join(repo, '.strata.toml'), 'utf8')).toBe(DEFAULT_CONFIG);
  });
});
