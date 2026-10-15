import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resumeRun, startRun } from '../src/workflow.js';
import { configuration, repository, temporaryDirectory, write } from './helpers/fixtures.js';
import { scriptedWorkflow } from './helpers/workflow.js';
import path from 'node:path';

vi.mock('../src/provider.js', async (original) => ({ ...await original<typeof import('../src/provider.js')>(), invoke: vi.fn(), run: vi.fn() }));
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
const start = (repo: string, config = configuration(repo), epicFile = '(inline epic)') => startRun(repo, '  Fixture epic  ', epicFile, config);

describe('stages, failures, and resumable attempts', () => {
  // ... (previous tests up to line 118 omitted for brevity)
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
