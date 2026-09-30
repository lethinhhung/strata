#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, initConfig, loadConfig } from './config.js';
import { loadRun, recordPath, resumeRun, RunError, startRun } from './runtime.js';
import { formatFailure, formatOutcome, printProgress } from './progress.js';

const version = '0.1.0';
const usage = `Strata — specification-led feature implementation runtime

Usage:
  strata init [--repo DIR] [--force]
  strata run EPIC [--repo DIR] [--config FILE]
  strata resume RUN_ID_OR_FILE [--repo DIR] [--config FILE]
  strata status [RUN_ID_OR_FILE] [--repo DIR]
  strata config-example
  strata --version`;

interface Args {
  positional: string[];
  options: {
    help?: boolean;
    version?: boolean;
    force?: boolean;
    repo?: string;
    config?: string;
    [key: string]: string | boolean | undefined;
  };
}

export function args(argv: string[]): Args {
  const positional: string[] = [];
  const options: Args['options'] = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--version') options.version = true;
    else if (token === '--force') options.force = true;
    else if (token === '--repo' || token === '--config') {
      if (!argv[i + 1]) throw new Error(`${token} requires a value`);
      options[token.slice(2)] = argv[++i];
    } else if (token.startsWith('-')) throw new Error(`Unknown option ${token}`);
    else positional.push(token);
  }
  return { positional, options };
}

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
    if (!positional[1]) throw new Error('run requires an epic file');
    const record = await startRun(repo, positional[1], config, printProgress);
    console.log(formatOutcome('run', record, recordPath(repo, record.run_id)));
    return record.status === 'complete' ? 0 : 1;
  }
  if (command === 'resume') {
    if (!positional[1]) throw new Error('resume requires a run id or record path');
    const file = resolveRun(repo, positional[1]);
    const record = await resumeRun(repo, file, config, printProgress);
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
