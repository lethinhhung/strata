import assert from 'node:assert/strict';
import { run } from '../src/provider.js';
import { test } from 'vitest';

// Test that an idle child process times out after the configured idle timeout.
// The child repeatedly writes to stderr, which should be considered activity
// for the inactivity timer, but since it never writes to stdout the overall
// run should still be marked as timedOut.

test('inactivity stops a silent child while stderr retries continue', async () => {
  const result = await run(process.execPath, [
    '-e',
    'setInterval(() => process.stderr.write("retry\\n"), 20)',
  ], process.cwd(), 5000, process.env, {
    idleTimeoutMs: 250,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.idleTimedOut, true);
  assert.match(result.stderr, /retry/);
});

// Test that stdout activity resets the inactivity timer but does not extend the
// absolute deadline. The run should still time out due to the short absolute
// deadline, but the idle timer should have been reset by stdout output.

test('stdout resets inactivity without extending the absolute deadline', async () => {
  const result = await run(process.execPath, [
    '-e',
    'setInterval(() => process.stdout.write("progress\\n"), 20)',
  ], process.cwd(), 500, process.env, {
    idleTimeoutMs: 250,
  });
  assert.equal(result.timedOut, true);
  // idleTimedOut should be undefined because the timeout was caused by the
  // absolute deadline, not inactivity.
  assert.equal(result.idleTimedOut, undefined);
  assert.match(result.stdout, /progress/);
});
