import assert from 'node:assert/strict';
import test from 'node:test';
import { invoke, ProviderError } from './providers.js';

test('provider rejects unsupported adapters with a useful error', async () => {
  await assert.rejects(invoke({
    provider: 'unknown', model: '', command: 'unused', timeout_seconds: 1, extra_args: [],
  }, 'prompt', '.', 'Test Agent'), (error: Error) => {
    assert.ok(error instanceof ProviderError);
    assert.match(error.message, /Unsupported CLI provider/);
    return true;
  });
});
