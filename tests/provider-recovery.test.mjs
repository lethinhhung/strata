import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { invoke, run } from '../dist/src/provider.js';
import { loadConfig } from '../dist/src/config.js';
import { startRun, resumeRun } from '../dist/src/workflow.js';

test('inactivity stops a silent child while stderr retries continue', async () => {
  const result = await run(process.execPath, ['-e', 'setInterval(() => process.stderr.write("retry\\n"), 20)'], process.cwd(), 5000, process.env, { idleTimeoutMs: 250 });
  assert.equal(result.timedOut, true);
  assert.equal(result.idleTimedOut, true);
  assert.match(result.stderr, /retry/);
});

test('stdout resets inactivity without extending the absolute deadline', async () => {
  const result = await run(process.execPath, ['-e', 'setInterval(() => process.stdout.write("progress\\n"), 20)'], process.cwd(), 500, process.env, { idleTimeoutMs: 250 });
  assert.equal(result.timedOut, true);
  assert.equal(result.idleTimedOut, undefined);
  assert.match(result.stdout, /progress/);
});

const fixtureProvider = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const prompt = args.at(-1);
const role = prompt.match(/^You are Strata's ([^.]+)\\./)?.[1];
const worker = args[0] === 'run';
const repo = process.cwd();
const trace = path.join(path.dirname(process.argv[1]), 'trace.jsonl');
fs.appendFileSync(trace, JSON.stringify({role, worker, args}) + '\\n');
function respond(text) {
  console.log(JSON.stringify(worker ? {type:'text',text} : {type:'item.completed',item:{type:'agent_message',text}}));
}
if (role === 'explore agent' && worker) {
  const invalid = (callID) => ({type:'tool_use',part:{tool:'glob',callID,state:{status:'error',error:"Model tried to call unavailable tool 'invalid'. Available tools: glob, grep, read."}}});
  if (args.includes('--invalid-tools')) {
    let count = 0;
    setInterval(() => console.log(JSON.stringify(invalid('call-' + ++count))), 20);
  } else if (args.includes('--duplicate-error')) {
    for (let count = 0; count < 3; count++) console.log(JSON.stringify(invalid('same-call')));
    respond('Recovered after one invalid call');
  } else if (args.includes('--ordinary-tool-error')) {
    for (let count = 0; count < 3; count++) console.log(JSON.stringify({type:'tool_use',part:{tool:'glob',state:{status:'error',error:'ripgrep execution failed'}}}));
    respond('Recovered after tool failures');
  } else if (args.includes('--nonzero-error')) {
    console.log(JSON.stringify({type:'text',part:{text:'unrelated transcript'}}));
    process.stdout.write(JSON.stringify({type:'error',error:{name:'UnknownError',data:{message:JSON.stringify({message:'unexpected tokens remaining in message header',type:'BadRequestError',code:400})}}}));
    process.exitCode = 1;
  } else {
    if (args.includes('--mutate')) fs.writeFileSync(path.join(repo, 'README.md'), 'unauthorized');
    console.log(JSON.stringify({type:'error',error:{data:{message:'Provider response headers timed out'}}}));
  }
} else if (role === 'explore agent') {
  if (args[args.indexOf('--sandbox') + 1] !== 'read-only') throw new Error('Recovery must be read-only');
  respond('Recovered exploration');
} else if (role === 'epic coordinator') {
  respond(JSON.stringify(prompt.includes('## task\\nIdentify')
    ? {exploration_tasks:[{question:'Inspect the fixture'}]}
    : {blockers:[],stages:[{id:'fixture',title:'fixture',objective:'Implement fixture',dependencies:[],completion_criteria:['Checks pass']}]}));
} else if (role === 'stage coordinator') {
  respond(JSON.stringify({implementation_tasks:[{task:'Implement fixture'}]}));
} else if (role === 'implementer') {
  fs.mkdirSync(path.join(repo, 'src'), {recursive:true});
  fs.writeFileSync(path.join(repo, 'src', 'fixture.ts'), '// implemented\\n');
  respond('Implemented fixture');
} else if (role === 'tester' || role === 'validator') {
  respond(JSON.stringify({status:'pass',findings:[],summary:'Fixture verified'}));
} else if (role === 'archivist') {
  fs.mkdirSync(path.join(repo, 'memory'), {recursive:true});
  fs.writeFileSync(path.join(repo, 'memory', 'fixture.md'), 'Fixture notes\\n');
  respond('Archived fixture');
} else throw new Error('Unexpected role: ' + role);
`;

async function withRepository(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'strata-provider-recovery-'));
  const repo = path.join(directory, 'repo');
  const remote = path.join(directory, 'remote.git');
  mkdirSync(repo);
  const hooks = path.join(directory, 'hooks');
  mkdirSync(hooks);
  const configFile = path.join(directory, 'gitconfig');
  writeFileSync(configFile, '');
  const overrides = { GIT_CONFIG_GLOBAL: configFile, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Strata Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Strata Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  const savedEnvironment = new Map(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  const git = (cwd, ...args) => {
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + hooks, ...args], {cwd, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git(repo, 'init', '-b', 'fixture');
    git(directory, 'init', '--bare', remote);
    git(repo, 'config', 'commit.gpgsign', 'false');
    git(repo, 'config', 'core.hooksPath', hooks);
    writeFileSync(path.join(repo, 'README.md'), 'original\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'fixture');
    git(repo, 'remote', 'add', 'origin', remote);
    const command = path.join(directory, 'provider.mjs');
    writeFileSync(command, fixtureProvider, {mode:0o755});
    const config = loadConfig(repo);
    config.worker.command = command;
    config.strong.command = command;
    const trace = () => readFileSync(path.join(directory, 'trace.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    await callback({repo, config, trace});
  } finally {
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(directory, {recursive:true, force:true});
  }
}

test('initial and stage exploration recover read-only through the strong agent', async () => {
  await withRepository(async ({repo, config, trace}) => {
    config.worker.extra_args = ['--invalid-tools'];
    const record = await startRun(repo, 'Implement fixture', '(inline epic)', config);
    assert.equal(record.status, 'complete');
    assert.deepEqual(trace().filter(call => call.role === 'explore agent').map(call => call.worker), [true, false, true, false]);
  });
});

test('nonzero OpenCode failures report the nested provider error without transcripts', async () => {
  await withRepository(async ({repo, config}) => {
    config.worker.extra_args = ['--nonzero-error'];
    await assert.rejects(invoke(config.worker, "You are Strata's explore agent.", repo, true), (error) => {
      assert.equal(error.message, 'opencode failed (explore agent): unexpected tokens remaining in message header');
      assert.doesNotMatch(error.message, /transcript|"type"|UnknownError/);
      return true;
    });
  });
});

test('three distinct malformed tool calls abort an active worker before its deadline', async () => {
  await withRepository(async ({repo, config}) => {
    config.worker.extra_args = ['--invalid-tools'];
    config.worker.timeout_seconds = 2;
    await assert.rejects(invoke(config.worker, "You are Strata's explore agent.", repo, true), /Model generated 3 unavailable-tool calls/);
  });
});

for (const [flag, response] of [['--duplicate-error', 'Recovered after one invalid call'], ['--ordinary-tool-error', 'Recovered after tool failures']]) {
  test('allows recovery from ' + flag, async () => {
    await withRepository(async ({repo, config}) => {
      config.worker.extra_args = [flag];
      assert.equal(await invoke(config.worker, "You are Strata's explore agent.", repo, true), response);
    });
  });
}

test('a failing explorer mutation is reverted before resume and does not trigger fallback', async () => {
  await withRepository(async ({repo, config, trace}) => {
    config.worker.extra_args = ['--mutate'];
    await assert.rejects(startRun(repo, 'Implement fixture', '(inline epic)', config), /read-only.*reverted/);
    assert.equal(readFileSync(path.join(repo, 'README.md'), 'utf8'), 'original\n');
    assert.deepEqual(trace().filter(call => call.role === 'explore agent').map(call => call.worker), [true]);
    const { readdirSync } = await import('node:fs');
    const recordFile = path.join(repo, 'docs', 'temps', readdirSync(path.join(repo, 'docs', 'temps'))[0]);
    const record = JSON.parse(readFileSync(recordFile, 'utf8'));
    assert.equal(record.status, 'failed');
    config.worker.extra_args = [];
    assert.equal((await resumeRun(repo, record.id, config)).status, 'complete');
  });
});
