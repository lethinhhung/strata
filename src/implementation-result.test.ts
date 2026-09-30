import assert from 'node:assert/strict';
import test from 'node:test';
import { implementationCanProceed } from './runtime/implementationResult.js';

test('reviews source edits even when implementer reports a failure', () => {
  assert.equal(implementationCanProceed('fail', false, ['src/runtime/types.ts']), true);
  assert.equal(implementationCanProceed('fail', false, []), false);
  assert.equal(implementationCanProceed('fail', true, ['src/runtime.test.ts']), false);
});
