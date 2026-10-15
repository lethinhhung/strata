import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { temporaryDirectory } from './helpers/fixtures.js';

describe('executable CLI entrypoint', () => {
  let entry: string;
  beforeAll(() => {
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
