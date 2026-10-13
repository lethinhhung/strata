import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { invoke } from '../src/provider.js';
import { configuration, git, repository, savedRun, temporaryDirectory, write } from './helpers/fixtures.js';
import { scriptedWorkflow, stage } from './helpers/workflow.js';

vi.mock('../src/provider.js', async (original) => ({ ...await original<typeof import('../src/provider.js')>(), invoke: vi.fn(), run: vi.fn() }));
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

describe('epic input and controlled workflow outcomes', () => {
  it.each(['inline', 'explicit file', 'positional file'])('runs %s epic and writes prompt/epic.md', async (input) => {
    const { repo } = repository();
    const source = path.join(temporaryDirectory(), 'epic.md');
    fs.writeFileSync(source, '  File epic\n');
    const args = input === 'inline' ? ['run', '  Inline epic  '] : input === 'explicit file' ? ['run', '--epic', source] : ['run', source];
    await scriptedWorkflow();
    expect(await runCli([...args, '--repo', repo])).toBe(0);
    expect(fs.readFileSync(path.join(repo, 'prompt', 'epic.md'), 'utf8')).toBe(input === 'inline' ? 'Inline epic\n' : 'File epic\n');
    const record = savedRun(repo);
    expect(record.epic_file).toBe(input === 'inline' ? '(inline epic)' : source);
    expect(output).toEqual([
      `Starting Strata run in ${repo}`,
      `Run ${record.id} complete: 1 stage(s)`,
      `Run record: ${path.join(repo, 'docs', 'temps', `${record.id}.json`)}`,
    ]);
    expect(errors).toContain('[strata] Plan repository exploration...');
    expect(errors).toContain('[strata] Plan repository exploration completed in 0s');
    expect(errors).toContain('[strata] Checkpoint stage first completed in 0s');
  });
  it.each(['missing file', 'empty text', 'empty file', 'extra positional'])('rejects %s before workflow execution', async (input) => {
    const { repo } = repository();
    const source = path.join(temporaryDirectory(), 'epic.md');
    fs.writeFileSync(source, ' \n');
    const args = input === 'missing file' ? ['run', '--epic', path.join(repo, 'missing.md')] : input === 'empty text' ? ['run', '  '] : input === 'empty file' ? ['run', '--epic', source] : ['run', 'extra', '--epic', source];
    const { calls } = await scriptedWorkflow();
    expect(await runCli([...args, '--repo', repo])).toBe(1);
    expect(errors.at(-1)).toMatch(input === 'missing file' ? /Epic file not found/ : input === 'extra positional' ? /either one quoted epic/ : /epic must not be empty/);
    expect(calls).toEqual([]);
    expect(fs.existsSync(path.join(repo, 'prompt'))).toBe(false);
  });
  it('loads explicit configuration and runs its configured harmless check', async () => {
    const { repo } = repository();
    write(repo, 'custom.toml', `[models.strong]\nmodel="custom-fixture"\n[workflow]\nimplement_fix_attempts=1\nchecks=[["${process.execPath}","-e","process.stdout.write('custom check')"]]\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'explicit config');
    await scriptedWorkflow();
    expect(await runCli(['run', 'Configured epic', '--repo', repo, '--config', 'custom.toml'])).toBe(0);
    expect(vi.mocked(invoke).mock.calls[0][0].model).toBe('custom-fixture');
    expect(savedRun(repo).stages[0].attempts[0].checks[0].output).toBe('custom check\n');
  });
  it('prints blocked status and its blocker and resumes through the CLI', async () => {
    const { repo } = repository();
    await scriptedWorkflow([], (call) => call.role === 'epic coordinator' && !call.prompt.includes('## task\nIdentify') ? '{"blockers":["clarify requirement"],"stages":[]}' : undefined);
    expect(await runCli(['run', 'Blocked epic', '--repo', repo])).toBe(1);
    const record = savedRun(repo);
    expect(record.status).toBe('blocked');
    expect(output).toContain(`Run ${record.id} blocked: 0 stage(s)`);
    expect(output).toContain('Blocker: clarify requirement');
    expect(fs.readFileSync(path.join(repo, 'prompt', 'epic.md'), 'utf8')).toBe('Blocked epic\n');
    await scriptedWorkflow();
    expect(await runCli(['resume', record.id, '--repo', repo])).toBe(0);
    expect(output.at(-1)).toBe(`Run ${record.id} complete: 1 stage(s)`);
  });
  it('prints workflow failures, returns nonzero, and resumes saved failed state', async () => {
    const { repo } = repository();
    write(repo, '.strata.toml', '[workflow]\nimplement_fix_attempts=1\n');
    await scriptedWorkflow([stage()], (call) => call.role === 'validator' ? '{"status":"fail","findings":["CLI regression mismatch"]}' : undefined);
    expect(await runCli(['run', 'Failure epic', '--repo', repo])).toBe(1);
    expect(errors.at(-1)).toMatch(/^strata: Stage first did not pass after 1/);
    const record = savedRun(repo);
    expect(record.status).toBe('failed');
    expect(fs.readFileSync(path.join(repo, 'prompt', 'epic.md'), 'utf8')).toBe('Failure epic\n');
    await scriptedWorkflow();
    expect(await runCli(['resume', path.join(repo, 'docs', 'temps', `${record.id}.json`), '--repo', repo])).toBe(0);
    expect(output.at(-1)).toBe(`Run ${record.id} complete: 1 stage(s)`);
  });
  it('prints missing resume-record errors', async () => {
    const repo = temporaryDirectory();
    expect(await runCli(['resume', 'missing', '--repo', repo])).toBe(1);
    expect(errors.at(-1)).toContain('Run record not found');
    expect(configuration(repo).workflow.implement_fix_attempts).toBe(3);
  });
});

describe('executable CLI entrypoint', () => {
  let entry: string;
  beforeAll(() => {
    // Compile into a disposable directory; npm test does not write production output.
    const directory = temporaryDirectory(true);
    const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.json', '--outDir', directory], { encoding: 'utf8' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    fs.symlinkSync(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'dir');
    fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
    entry = path.join(directory, 'src', 'cli.js');
  });
  it.each([
    [['--help'], 0, /Usage:/],
    [['--version'], 0, /strata 0\.2\.0/],
    [['--bad'], 1, /Unknown option --bad/],
    [['run'], 1, /requires one quoted epic/],
  ] as [string[], number, RegExp][])('exits with the expected process status for %j', (args, code, text) => {
    const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
    expect(result.status).toBe(code);
    expect(code === 0 ? result.stdout : result.stderr).toMatch(text);
  });
});
