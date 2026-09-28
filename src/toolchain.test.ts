import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('TypeScript package builds before running compiled tests', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const tsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.equal(tsconfig.compilerOptions.outDir, 'dist');
  assert.match(pkg.scripts.test, /npm run build && node --test dist\/src\/\*\.test\.js/);
  assert.equal(pkg.engines.node, '>=20');
  assert.equal(pkg.bin.strata, './dist/src/cli.js');
  assert.ok(pkg.devDependencies.typescript);
  assert.ok(pkg.devDependencies['@types/node']);
});

test('generated output is excluded from source control', () => {
  assert.match(readFileSync('.gitignore', 'utf8'), /^dist\/$/m);
  assert.ok(!readFileSync('tsconfig.json', 'utf8').includes('"dist/src"'));
});
