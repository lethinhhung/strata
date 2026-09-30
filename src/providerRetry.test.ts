import assert from 'node:assert/strict';
import test from 'node:test';
import { isTransientFailure, isTransientProviderEvent, retryDelay } from './providerRetry.js';

test('provider retries transient overload and rate limit responses', () => {
  assert.equal(isTransientFailure('Service temporarily overloaded'), true);
  assert.equal(isTransientFailure('429 Too Many Requests'), true);
  assert.equal(isTransientFailure('invalid credentials'), false);
  assert.equal(isTransientFailure('getaddrinfo ENOTFOUND integrate.api.nvidia.com'), true);
  assert.equal(retryDelay(0, '429 Too Many Requests'), 15_000);
  assert.equal(retryDelay(1, '503 unavailable'), 20_000);
  assert.equal(retryDelay(0, 'retry-after: 4'), 4_000);
  assert.equal(retryDelay(1, 'no agent text response'), 2_000);
  assert.equal(isTransientProviderEvent('{"type":"error","error":{"message":"429 Too Many Requests"}}'), true);
  assert.equal(isTransientProviderEvent('{"type":"text","text":"429 Too Many Requests"}'), false);
});
