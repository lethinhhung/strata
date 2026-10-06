import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initConfig, loadConfig } from './config.js';
import { loadWorkflow } from './workflowConfig.js';

test('config loads model defaults and configured workflow gates', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'strata-config-'));
  try {
    initConfig(repo);
    const config = loadConfig(repo);
    assert.equal(config.strong.command, 'codex');
    assert.equal(config.worker.command, 'opencode');
    assert.deepEqual(config.workflow.test_commands, []);
    assert.equal(config.workflow.review_repair_attempts, 3);
    assert.equal(config.workflow.test_repair_attempts, 3);
    assert.equal(config.workflow.validation_repair_attempts, 3);
    assert.equal(config.workflow.check_concurrency, 1);
    writeFileSync(path.join(repo, '.strata.toml'), '[workflow]\ncheckpoint = true\ntest_commands = [["npm", "test"]]\n');
    assert.deepEqual(loadConfig(repo).workflow.test_commands, [['npm', 'test']]);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('workflow check concurrency accepts bounded positive integers', () => {
  assert.equal(loadWorkflow({ check_concurrency: 4 }).check_concurrency, 4);
  assert.throws(() => loadWorkflow({ check_concurrency: 0 }), /workflow.check_concurrency/);
  assert.throws(() => loadWorkflow({ check_concurrency: 1.5 }), /workflow.check_concurrency/);
  assert.throws(() => loadWorkflow({ check_concurrency: 9 }), /workflow.check_concurrency/);
});
