import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

const lineLimitExemptions = new Set([
  'bun.lock', 'bun.lockb', 'npm-shrinkwrap.json', 'package-lock.json',
  'pnpm-lock.yaml', 'yarn.lock', 'config.ts', 'runStageGates.ts',
]);

test('tracked maintained text files stay below 120 lines', () => {
  const files = execFileSync('git', ['ls-files', '--cached', '-z'], { encoding: 'utf8' })
    .split('\0').filter(Boolean);
  const oversized = files.filter((file) => !file.startsWith('docs/temps/'))
    .filter((file) => !lineLimitExemptions.has(file.split('/').at(-1) ?? '')).filter((file) => {
    const buffer = fs.readFileSync(file);
    if (buffer.includes(0)) return false;
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/);
    if (text.endsWith('\n')) lines.pop();
    return lines.length > 119;
  });
  assert.deepEqual(oversized, []);
});
