import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { resumeRun, startRun } from '../src/workflow.js';
import { setupFixture } from './helpers/provider-recovery-fixture.js';
import { configuration, repository, savedRun } from './helpers/fixtures.js';

function recoveryRepo() {
  const { repo } = repository();
  const provider = setupFixture(repo, '../fixture-provider.js');
  const source = readFileSync(provider, 'utf8')
    .replace(/(args\}\) \+ )'\n'/, (_match, prefix) => `${prefix}'\\n'`)
    .replace("'## task\nIdentify'", "'## task\\nIdentify'")
    .replace("'// implemented\n'", "'// implemented\\n'")
    .replace("'Fixture durable notes\n'", "'Fixture durable notes\\n'");
  writeFileSync(provider, source, { mode: 0o755 });
  const config = configuration(repo);
  config.worker.provider = 'opencode';
  config.worker.command = provider;
  config.strong.command = provider;
  return { repo, config };
}

test('initial and stage exploration recover read-only through the strong agent', async () => {
  const { repo, config } = recoveryRepo();
  config.worker.extra_args = ['--invalid-tools'];
  const record = await startRun(repo, 'Implement fixture', '(inline epic)', config);
  expect(record.status).toBe('complete');
  const calls = readFileSync(join(dirname(config.worker.command), 'trace.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  expect(calls.filter((call) => call.role === 'explore agent').map((call) => call.worker))
    .toEqual([true, false, true, false]);
});

test('a failing explorer mutation is reverted before resume and does not trigger fallback', async () => {
  const { repo, config } = recoveryRepo();
  config.worker.extra_args = ['--mutate'];
  await expect(startRun(repo, 'Implement fixture', '(inline epic)', config)).rejects.toThrow(/read-only.*reverted/);
  expect(readFileSync(`${repo}/README.md`, 'utf8')).toBe('Disposable regression repository.\n');
  const failed = savedRun(repo);
  config.worker.extra_args = [];
  expect((await resumeRun(repo, failed.id, config)).status).toBe('complete');
});
