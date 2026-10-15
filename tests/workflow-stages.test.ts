import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resumeRun, startRun } from '../src/workflow.js';
import { configuration, git, repository, savedRun } from './helpers/fixtures.js';
import fs from 'node:fs';
import { scriptedWorkflow, stage } from './helpers/workflow.js';
import { run } from '../src/provider.js';
import path from 'node:path';

vi.mock('../src/provider.js', async (original) => ({ ...await original<typeof import('../src/provider.js')>(), invoke: vi.fn(), run: vi.fn() }));
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
const start = (repo: string, config = configuration(repo), epicFile = '(inline epic)') => startRun(repo, '  Fixture epic  ', epicFile, config);
const failResult = { code: 1, stdout: '', stderr: 'controlled failure', timedOut: false };

describe('stages, failures, and resumable attempts', () => {
  it('checkpoints and archives stages in dependency order to a local remote', async () => {
    const { repo, remote } = repository();
    const { calls } = await scriptedWorkflow([stage(), stage('second', ['first'])], (call) => {
      if (call.role === 'implementer' && call.stage?.id === 'second') {
        expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(remote, 'rev-parse', 'refs/heads/work'));
        expect(savedRun(repo).stages[0].status).toBe('complete');
      }
      return undefined;
    });
    const record = await start(repo);
    expect(record.status).toBe('complete');
    expect(record.stages.map((item) => item.status)).toEqual(['complete', 'complete']);
    expect(calls.filter((call) => call.role === 'implementer').map((call) => call.stage?.id)).toEqual(['first', 'second']);
    expect(calls.filter((call) => call.role === 'archivist')).toHaveLength(2);
    expect(calls.filter((call) => ['epic coordinator', 'explore agent', 'stage coordinator', 'validator'].includes(call.role)).every((call) => call.readOnly)).toBe(true);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(remote, 'rev-parse', 'refs/heads/work'));
    expect(git(repo, 'log', '--format=%s')).toContain('strata: first');
    expect(git(repo, 'log', '--format=%s')).toContain('strata: second');
    expect(fs.readFileSync(path.join(repo, 'memory', 'second.md'), 'utf8')).toContain('durable notes');
  });
  it.each([[['absent']], [['second']]])('rejects missing or incomplete dependency %s before implementation', async (dependencies) => {
    const { repo } = repository();
    const { calls } = await scriptedWorkflow([stage('first', dependencies), stage('second')]);
    await expect(start(repo)).rejects.toThrow(/incomplete dependencies/);
    expect(calls.some((call) => call.role === 'implementer')).toBe(false);
    expect(savedRun(repo)).toMatchObject({ status: 'failed', error: expect.stringContaining('incomplete dependencies') });
    await expect(resumeRun(repo, savedRun(repo).id, configuration(repo))).rejects.toThrow(/incomplete dependencies/);
    expect(calls.some((call) => call.role === 'implementer')).toBe(false);
  });
  it.each(['check', 'tester', 'tester process', 'validator', 'validator process', 'implementer'])(
    'persists bounded %s failure and skips archive/checkpoint', async (failure) => {
    const { repo } = repository();
    const config = configuration(repo);
    config.workflow.implement_fix_attempts = 2;
    const { calls, actualRun } = await scriptedWorkflow([stage()], (call) => {
      if (failure === 'implementer' && call.role === 'implementer') throw new Error('implementer failure');
      if (call.role === failure) return JSON.stringify({ status: 'fail', findings: [`${failure} regression finding`], summary: 'Concrete mismatch' });
      if (`${call.role} process` === failure || (failure === 'implementer' && call.role === 'implementer')) throw new Error(`${failure} failure`);
      return undefined;
    });
    if (failure === 'check') {
      config.workflow.checks = ['fixture-check'].map((command) => [command]);
      vi.mocked(run).mockImplementation((command, args, cwd, timeout, env) => command === 'fixture-check' ? Promise.resolve(failResult) : actualRun(command, args, cwd, timeout, env));
    }
    await expect(start(repo, config)).rejects.toThrow(/after 2 implement\/fix attempts/);
    const record = savedRun(repo);
    expect(record.status).toBe('failed');
    expect(record.error).toContain('after 2');
    expect(record.stages[0].status).not.toBe('complete');
    expect(record.stages[0].attempts.map((attempt: { passed: boolean; attempt: number }) => [attempt.attempt, attempt.passed])).toEqual([[1, false], [2, false]]);
    expect(JSON.stringify(record.stages[0].attempts)).toContain(failure === 'check' ? 'controlled failure' : failure);
    expect(record.history.filter((event: { type: string }) => event.type === 'stage_attempt')).toHaveLength(2);
    expect(calls.filter((call) => call.role === 'stage coordinator')[1].prompt).toContain(failure === 'check' ? 'controlled failure' : failure);
    expect(calls.some((call) => call.role === 'archivist')).toBe(false);
    expect(record.history.some((event: { type: string }) => ['archive', 'stage_complete'].includes(event.type))).toBe(false);
    expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(fs.existsSync(path.join(repo, 'memory'))).toBe(false);
  },
  );
  it('uses three attempts by default and resumes with prior findings without a lifetime retry cap', async () => {
    const { repo } = repository();
    const config = configuration(repo);
    await scriptedWorkflow([stage()], (call) => call.role === 'validator' ? JSON.stringify({ status: 'fail', findings: ['preserve this mismatch'], summary: 'Mismatch' }) : undefined);
    await expect(start(repo, config)).rejects.toThrow(/after 3/);
    const failed = savedRun(repo);
    expect(failed.stages[0].attempts).toHaveLength(3);
    const { calls } = await scriptedWorkflow();
    const resumed = await resumeRun(repo, failed.id, config);
    expect(resumed.status).toBe('complete');
    expect(resumed.error).toBeUndefined();
    expect(resumed.stages[0].attempts).toHaveLength(4);
    expect(resumed.stages[0].attempts!.at(-1).attempt).toBe(1);
    expect(calls.find((call) => call.role === 'stage coordinator')?.prompt).toContain('preserve this mismatch');
    expect(calls.find((call) => call.role === 'implementer')?.prompt).toContain('preserve this mismatch');
    expect(resumed.stages[0].attempts![0].validation.findings).toContain('preserve this mismatch');
  });
  it('resumes a failed dependent stage and skips an already checkpointed stage', async () => {
    const { repo } = repository();
    const config = configuration(repo);
    config.workflow.implement_fix_attempts = 1;
    await scriptedWorkflow([stage(), stage('second', ['first'])], (call) => call.role === 'validator' && call.stage?.id === 'second' ? '{"status":"fail","findings":["second mismatch"]}' : undefined);
    await expect(start(repo, config)).rejects.toThrow(/Stage second/);
    const failed = savedRun(repo);
    expect(failed.stages[0].status).toBe('complete');
    const { calls } = await scriptedWorkflow();
    const resumed = await resumeRun(repo, failed.id, config);
    expect(resumed.status).toBe('complete');
    expect(calls.filter((call) => call.stage).every((call) => call.stage?.id === 'second')).toBe(true);
    expect(resumed.stages[0].attempts).toHaveLength(1);
    expect(resumed.stages[1].attempts).toHaveLength(2);
  });
  // removed test block moved to workflow-stage-resume.test.ts
});
