#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, initConfig, loadConfig } from './config.js';
import { resumeRun, startRun } from './workflow.js';

const usage = `Strata — specification-led feature implementation

Usage:
  strata run "Describe the feature" --repo DIR
  strata run --epic FILE --repo DIR
  strata resume RUN_ID_OR_FILE --repo DIR
  strata init [--repo DIR] [--force]
  strata status [--repo DIR]
  strata --help | --version

If --epic is omitted, the single run argument is treated as the epic text. A positional
argument naming an existing file is also accepted for compatibility.`;

interface Parsed { positional: string[]; options: Record<string, string | boolean> }

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const options: Parsed['options'] = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--version') options.version = true;
    else if (token === '--force') options.force = true;
    else if (['--repo', '--epic', '--config'].includes(token)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
      options[token.slice(2)] = value;
    } else if (token.startsWith('-')) throw new Error(`Unknown option ${token}`);
    else positional.push(token);
  }
  return { positional, options };
}

async function main(argv: string[]): Promise<number> {
  const { positional, options } = parseArgs(argv);
  if (options.help || positional[0] === 'help') { console.log(usage); return 0; }
  if (options.version) { console.log('strata 0.2.0'); return 0; }
  const command = positional[0];
  const repo = path.resolve(String(options.repo ?? '.'));
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new Error(`Repository path does not exist: ${repo}`);
  if (command === 'init') { console.log(`Created ${initConfig(repo, options.force === true)}`); return 0; }
  if (command === 'status') {
    const directory = path.join(repo, 'docs', 'temps');
    const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort().reverse() : [];
    if (!files.length) console.log('No Strata runs found.');
    for (const name of files.slice(0, 20)) {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
        console.log(`${record.id}\t${record.status}\t${record.updated_at}`);
      } catch { /* ignore unrelated JSON artifacts */ }
    }
    return 0;
  }
  if (command === 'resume') {
    if (positional.length !== 2) throw new Error('resume requires a run id or run record path');
    const config = loadConfig(repo, typeof options.config === 'string' ? options.config : undefined);
    const record = await resumeRun(repo, positional[1], config);
    console.log(`Run ${record.id} ${record.status}: ${record.stages.length} stage(s)`);
    return record.status === 'complete' ? 0 : 1;
  }
  if (command !== 'run') throw new Error(`Unknown command ${command ?? '(empty)'}`);

  let epic: string;
  let epicFile: string;
  if (typeof options.epic === 'string') {
    epicFile = path.resolve(String(options.epic));
    if (!fs.existsSync(epicFile) || !fs.statSync(epicFile).isFile()) throw new Error(`Epic file not found: ${epicFile}`);
    epic = fs.readFileSync(epicFile, 'utf8');
  } else {
    if (positional.length !== 2) throw new Error('run requires one quoted epic description or --epic FILE');
    const candidate = path.resolve(positional[1]);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      epicFile = candidate;
      epic = fs.readFileSync(candidate, 'utf8');
    } else {
      epic = positional[1];
      epicFile = '(inline epic)';
    }
  }
  if (!epic.trim()) throw new Error('The epic must not be empty');
  const config = loadConfig(repo, typeof options.config === 'string' ? options.config : undefined);
  console.log(`Starting Strata run in ${repo}`);
  const record = await startRun(repo, epic, epicFile, config);
  console.log(`Run ${record.id} ${record.status}: ${record.stages.length} stage(s)`);
  console.log(`Run record: ${path.join(repo, 'docs', 'temps', `${record.id}.json`)}`);
  return record.status === 'complete' ? 0 : 1;
}

const entry = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`strata: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export { DEFAULT_CONFIG };
