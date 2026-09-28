import * as utils from './utils.js';
import path from 'node:path';
import fs from 'node:fs';
import { RunError } from './types.js';

export async function archiveMemory(repo: string, record: any, config: any) {
  const current = utils.readTree(repo, [config.workflow.memory_path], 12_000);
  const result = await utils.askReadOnly(config, 'Archivist', {
    repo,
    shape: '{"entries":[{"class":"decision|note|progress","content":"..."}]}',
    text: `This run succeeded. Review it and current memory; propose only observed reusable engineering knowledge, check duplicates, and never include credentials, secrets, private content, or raw application data. Do not write specs, tests, or source. Include date, affected paths, and run id in entries.\nRUN:\n${utils.json(record)}\nCURRENT MEMORY:\n${current}`,
  }, current, { strong: true });
  const entries = Array.isArray(result.entries) ? result.entries : [];
  if (!entries.length) return { status: 'complete', entries: 0 };
  const directory = path.resolve(repo, config.workflow.memory_path);
  if (!directory.startsWith(`${path.resolve(repo)}${path.sep}`)) throw new RunError('Configured memory path must remain inside the repository');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, 'archive.md');
  for (const entry of entries) {
    if (!entry?.content || !['decision', 'note', 'progress'].includes(entry.class)) continue;
    if (/(api[_ -]?key|secret|password|token)\s*[:=]\s*\S+/i.test(entry.content)) continue;
    if (current.includes(entry.content)) continue;
    fs.appendFileSync(target, `\n## ${entry.class[0].toUpperCase()}${entry.class.slice(1)} — ${utils.now().slice(0, 10)}\n\n${entry.content}\n`, 'utf8');
  }
  return { status: 'complete', entries: entries.length, path: path.relative(repo, target) };
}
