import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { temporaryDirectory, write } from './helpers/fixtures.js';

let output: string[];
let errors: string[];
beforeEach(() => {
  output = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => output.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => errors.push(args.join(' ')));
});

describe('CLI output and argument handling', () => {
  it.each([['--help'], ['-h'], ['help']])('prints help for %s', async (option) => {
    expect(await runCli([option])).toBe(0);
    expect(output.join('\n')).toContain('Usage:');
    expect(output.join('\n')).toContain('strata run');
    expect(errors).toEqual([]);
  });
  it('prints the package version', async () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(await runCli(['--version'])).toBe(0);
    expect(output).toEqual([`strata ${pkg.version}`]);
  });
  it.each([
    [[], /Unknown command \(empty\)/],
    [['unknown'], /Unknown command unknown/],
    [['--unknown'], /Unknown option --unknown/],
    [['-x'], /Unknown option -x/],
    [['run'], /requires one quoted epic/],
    [['run', 'one', 'two'], /requires one quoted epic/],
    [['resume'], /requires a run id/],
    [['resume', 'one', 'two'], /requires a run id/],
    ...['--repo', '--config', '--epic'].flatMap((option): [string[], RegExp][] => [
      [[option], new RegExp(`${option} requires a value`)],
      [[option, '--help'], new RegExp(`${option} requires a value`)],
    ]),
  ] as [string[], RegExp][])('returns failure for arguments %j', async (args, error) => {
    const repo = temporaryDirectory();
    expect(await runCli([...args, '--repo', repo])).toBe(1);
    expect(errors.join('\n')).toMatch(error);
  });
  it('rejects missing repositories and file paths used as repositories', async () => {
    const repo = temporaryDirectory();
    write(repo, 'file', 'not a directory');
    for (const relative of ['missing', 'file']) {
      expect(await runCli(['status', '--repo', path.join(repo, relative)])).toBe(1);
      expect(errors.at(-1)).toContain('Repository path does not exist');
    }
  });
  it('initializes config, protects existing bytes, and supports force', async () => {
    const repo = temporaryDirectory();
    expect(await runCli(['init', '--repo', repo])).toBe(0);
    expect(output.at(-1)).toBe(`Created ${path.join(repo, '.strata.toml')}`);
    write(repo, '.strata.toml', 'preserved bytes');
    expect(await runCli(['init', '--repo', repo])).toBe(1);
    expect(errors.at(-1)).toContain('already exists');
    expect(fs.readFileSync(path.join(repo, '.strata.toml'), 'utf8')).toBe('preserved bytes');
    expect(await runCli(['init', '--repo', repo, '--force'])).toBe(0);
    expect(fs.readFileSync(path.join(repo, '.strata.toml'), 'utf8')).toBe(DEFAULT_CONFIG);
  });
  it('prints empty and populated status while ignoring unrelated malformed JSON', async () => {
    const repo = temporaryDirectory();
    expect(await runCli(['status', '--repo', repo])).toBe(0);
    expect(output).toEqual(['No Strata runs found.']);
    output.splice(0);
    write(repo, 'docs/temps/001.json', JSON.stringify({ id: '001', status: 'failed', updated_at: 'yesterday' }));
    write(repo, 'docs/temps/002.json', JSON.stringify({ id: '002', status: 'complete', updated_at: 'today' }));
    write(repo, 'docs/temps/003.json', '{malformed unrelated artifact');
    write(repo, 'docs/temps/ignored.txt', 'ignored');
    expect(await runCli(['status', '--repo', repo])).toBe(0);
    expect(output).toEqual(['002\tcomplete\ttoday', '001\tfailed\tyesterday']);
    expect(errors).toEqual([]);
  });
});
