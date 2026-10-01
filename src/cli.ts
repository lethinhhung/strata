#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, initConfig, loadConfig } from './config.js';
import { loadRun, recordPath, resumeRun, RunError, startRun } from './runtime.js';
import type { RunRecord } from './runtime/types.js';
import { args } from './cliArgs.js';
import { createProgressReporter, formatFailure, formatOutcome } from './progress.js';
export { args } from './cliArgs.js';

const version = '0.1.0';
const usage = `Strata — specification-led feature implementation runtime

Usage:
  strata init [--repo DIR] [--force]
  strata run EPIC [--repo DIR] [--config FILE]
  strata run --prompt TEXT [--repo DIR] [--config FILE]
  strata resume RUN_ID_OR_FILE [--repo DIR] [--config FILE]
  strata status [RUN_ID_OR_FILE] [--repo DIR]
  strata config-example
  strata --version`;

function resolveRun(repo: string, reference: string): string {
  const candidate = path.resolve(repo, reference);
  if (fs.existsSync(candidate)) return candidate;
  const byId = recordPath(repo, reference);
  if (fs.existsSync(byId)) return byId;
  throw new RunError(`Run record not found: ${reference}`);
}

async function main(): Promise<number> {
  const { positional, options } = args(process.argv.slice(2));
  if (options.help || positional[0] === 'help') { console.log(usage); return 0; }
  if (options.version) { console.log(`strata ${version}`); return 0; }
  const command = positional[0];
  if (command === 'config-example') { console.log(DEFAULT_CONFIG); return 0; }
  const repo = path.resolve(options.repo ?? '.');
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new RunError(`Repository path does not exist: ${repo}`);
  if (command === 'init') {
    console.log(`Created ${initConfig(repo, options.force)}`);
    return 0;
  }
  if (command === 'status') {
    if (positional[1]) console.log(JSON.stringify(loadRun(resolveRun(repo, positional[1])), null, 2));
    else {
      const directory = path.join(repo, 'docs', 'temps');
      const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter((file) => {
        if (!file.endsWith('.md')) return false;
        return fs.readFileSync(path.join(directory, file), 'utf8').startsWith('# Strata run ');
      }).sort().reverse().slice(0, 20) : [];
      if (!files.length) console.log('No Strata runs found.');
      for (const name of files) {
        const record = loadRun(path.join(directory, name));
        console.log(`${record.run_id}\t${record.status}\t${record.created_at}`);
      }
    }
    return 0;
  }
  const config = loadConfig(repo, options.config);
  if (command === 'run') {
    const inlinePrompt = typeof options.prompt === 'string' ? options.prompt : undefined;
    if (Boolean(positional[1]) === Boolean(inlinePrompt)) throw new Error('run requires exactly one epic file or --prompt TEXT');
    const reporter = createProgressReporter();
    let record: RunRecord;
    try {
      record = await startRun(repo, positional[1] ?? '', config, reporter.print, inlinePrompt);
    } finally {
      reporter.finish();
    }
    console.log(formatOutcome('run', record, recordPath(repo, record.run_id)));
    return record.status === 'complete' ? 0 : 1;
  }
  if (command === 'resume') {
    if (!positional[1]) throw new Error('resume requires a run id or record path');
    const file = resolveRun(repo, positional[1]);
    const reporter = createProgressReporter();
    let record: RunRecord;
    try {
      record = await resumeRun(repo, file, config, reporter.print);
    } finally {
      reporter.finish();
    }
    console.log(formatOutcome('resume', record, file));
    return record.status === 'complete' ? 0 : 1;
  }
  throw new Error(`Unknown command ${command ?? '(empty)'}`);
}

const invokedFile = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
if (invokedFile === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(formatFailure(error));
    process.exitCode = 2;
  });
}
