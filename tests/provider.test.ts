import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../src/config.js';
import { invoke, jsonResponse, run } from '../src/provider.js';
import { temporaryDirectory } from './helpers/fixtures.js';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: spawnMock }));

function child() {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
}
function response(stdout: string, code: number | null = 0, stderr = '') {
  spawnMock.mockImplementation(() => {
    const process = child();
    queueMicrotask(() => {
      process.stdout.emit('data', Buffer.from(stdout));
      process.stderr.emit('data', Buffer.from(stderr));
      process.emit('close', code);
    });
    return process;
  });
}
const agent = (provider: AgentConfig['provider'] = 'codex'): AgentConfig => ({ provider, command: 'local-provider', model: '', extra_args: [], timeout_seconds: 5 });
beforeEach(() => {
  spawnMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe('provider invocation', () => {
  it.each([true, false])('constructs Codex arguments with readOnly=%s', async (readOnly) => {
    response('{"type":"item.completed","item":{"type":"agent_message","text":"answer"}}');
    const config = { ...agent(), model: 'fixture-model', extra_args: ['--extra'] };
    expect(await invoke(config, 'prompt', '/fixture', readOnly)).toBe('answer');
    expect(spawnMock).toHaveBeenCalledWith('local-provider', ['exec', '--json', '--cd', '/fixture', '--sandbox', readOnly ? 'read-only' : 'workspace-write', '--config', 'approval_policy="never"', '--model', 'fixture-model', '--extra', 'prompt'], { cwd: '/fixture', stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  });
  it('omits an empty model and uses the last Codex agent or turn message', async () => {
    response('diagnostic\n{"type":"item.completed","item":{"type":"agent_message","text":"first"}}\n{"type":"turn.completed","text":"last"}');
    expect(await invoke(agent(), 'prompt', '/fixture')).toBe('last');
    expect(spawnMock.mock.calls[0][1]).not.toContain('--model');
  });
  it.each([true, false])('constructs OpenCode arguments and isolated permissions with readOnly=%s', async (readOnly) => {
    const previous = process.env.OPENCODE_PERMISSION;
    response('{"type":"text","text":"first"}\nlog\n{"part":{"type":"text","text":"second"}}\n{"type":"event","part":{"type":"text"},"text":"third"}');
    expect(await invoke({ ...agent('opencode'), model: 'worker', extra_args: ['--extra'] }, 'prompt', '/fixture', readOnly)).toBe('first\nsecond\nthird');
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe('local-provider');
    expect(args).toEqual(['run', '--format', 'json', '--dir', '/fixture', '--model', 'worker', '--extra', 'prompt']);
    expect(options.cwd).toBe('/fixture');
    expect(process.env.OPENCODE_PERMISSION).toBe(previous);
    if (readOnly) {
      expect(options.env).not.toBe(process.env);
      expect(JSON.parse(options.env.OPENCODE_PERMISSION)).toEqual({ '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow', lsp: 'allow' });
    } else expect(options.env).toBe(process.env);
  });
  it.each(['codex', 'opencode'] as const)('retains raw response fallback for %s', async (provider) => {
    response('raw answer');
    expect(await invoke(agent(provider), 'prompt', '/fixture')).toBe('raw answer');
  });
  it('fits long OpenCode prompts while retaining the beginning and end', async () => {
    response('answer');
    await invoke(agent('opencode'), `BEGIN${'x'.repeat(22000)}END`, '/fixture');
    const prompt = spawnMock.mock.calls[0][1].at(-1) as string;
    expect(prompt).toMatch(/^BEGIN/);
    expect(prompt).toMatch(/END$/);
    expect(prompt).toContain('Strata omitted');
    expect(prompt.length).toBeLessThan(19000);
    expect(spawnMock.mock.calls[0][1]).not.toContain('--model');
  });
  it.each(['', '  \n'])('rejects empty response %j', async (text) => {
    response(text);
    await expect(invoke(agent(), 'prompt', '/fixture')).rejects.toThrow(/no agent response/);
  });
  it.each([['diagnostic', 'output', 'diagnostic'], ['', 'output', 'output']])('reports nonzero exit diagnostics %s', async (stderr, stdout, expected) => {
    response(stdout, 7, stderr);
    await expect(invoke(agent(), 'prompt', '/fixture')).rejects.toThrow(`exited 7: ${expected}`);
  });
  it('rejects spawn failures and clears heartbeat and timeout timers', async () => {
    vi.useFakeTimers();
    const process = child();
    spawnMock.mockReturnValue(process);
    const result = expect(invoke(agent(), 'prompt', '/fixture')).rejects.toThrow('spawn failed');
    process.emit('error', new Error('spawn failed'));
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out, escalates termination, and clears timers on close', async () => {
    vi.useFakeTimers();
    const process = child();
    spawnMock.mockReturnValue(process);
    const result = expect(invoke({ ...agent(), timeout_seconds: 65 }, 'prompt', '/fixture')).rejects.toThrow('timed out after 65s');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('still running'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(process.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(2000);
    expect(process.kill).toHaveBeenCalledWith('SIGKILL');
    process.emit('close', null);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels escalation when the child closes after SIGTERM', async () => {
    vi.useFakeTimers();
    const process = child();
    spawnMock.mockReturnValue(process);
    const result = run('local', [], '/fixture', 1);
    await vi.advanceTimersByTimeAsync(1);
    process.emit('close', null);
    expect(await result).toMatchObject({ code: null, timedOut: true });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('runs and awaits a harmless local child with the requested cwd and environment', async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    spawnMock.mockImplementation(actual.spawn);
    const cwd = temporaryDirectory();
    expect(await run(process.execPath, ['-e', 'process.stdout.write(process.cwd()+process.env.STRATA_TEST_VALUE);process.stderr.write("diagnostic")'], cwd, 5000, { ...process.env, STRATA_TEST_VALUE: 'fixture' })).toEqual({ code: 0, stdout: `${cwd}fixture`, stderr: 'diagnostic', timedOut: false });
  });
});

describe('JSON responses', () => {
  it.each([
    ['{"ok":true}', { ok: true }],
    ['```json\n{"ok":false}\n```', { ok: false }],
    ['prefix {bad} then ' + JSON.stringify({ nested: { text: 'braces } { and "quote"', value: 1 } }) + ' suffix', { nested: { text: 'braces } { and "quote"', value: 1 } }],
    ['[1,2]', [1, 2]],
  ])('parses %s', (text, expected) => expect(jsonResponse(text)).toEqual(expected));
  it.each(['no JSON', '{invalid}', '{"unfinished":'])('rejects %s', (text) => expect(() => jsonResponse(text)).toThrow(/valid JSON/));
});
