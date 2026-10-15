
import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
// removed unused import run
import { resumeRun, startRun } from '../src/workflow.js';
import { configuration, repository, savedRun, temporaryDirectory, write } from './helpers/fixtures.js';
import { scriptedWorkflow } from './helpers/workflow.js';

vi.mock('../src/provider.js', async (original) => ({ ...await original<typeof import('../src/provider.js')>(), invoke: vi.fn(), run: vi.fn() }));
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
const start = (repo: string, config = configuration(repo), epicFile = '(inline epic)') => startRun(repo, '  Fixture epic  ', epicFile, config);
// tests from original lines 107-131

describe('stages, failures, and resumable attempts (resume block)', () => {
  it('records blocked planning and replans successfully on resume', async () => {
    const { repo } = repository();
    await scriptedWorkflow([], (call) => call.role === 'epic coordinator' && !call.prompt.includes('## task\nIdentify') ? '{"blockers":["need requirement"],"stages":[]}' : undefined);
    const record = await start(repo);
    expect(record.status).toBe('blocked');
    expect(savedRun(repo).blockers).toEqual(['need requirement']);
    await scriptedWorkflow();
    const resumed = await resumeRun(repo, `${record.id}.json`, configuration(repo));
    expect(resumed.status).toBe('complete');
    expect(resumed.blockers).toEqual([]);
    expect(resumed.history.some((event) => event.type === 'blocked')).toBe(true);
  });
  it('rejects missing and foreign run records and returns completed records without provider calls', async () => {
    const { repo } = repository();
    const { calls } = await scriptedWorkflow();
    await expect(resumeRun(repo, 'absent', configuration(repo))).rejects.toThrow(/not found/);
    const record = await start(repo);
    const file = path.join(repo, 'docs', 'temps', `${record.id}.json`);
    calls.splice(0);
    expect(await resumeRun(repo, file, configuration(repo))).toMatchObject({ status: 'complete' });
    expect(calls).toEqual([]);
    write(repo, 'foreign.json', JSON.stringify({ ...record, repo: temporaryDirectory() }));
    await expect(resumeRun(repo, 'foreign.json', configuration(repo))).rejects.toThrow(/another repository/);
  });
});
