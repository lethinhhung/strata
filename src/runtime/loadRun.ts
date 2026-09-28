import { readFileSync } from 'node:fs';
import { RunError } from './types.js';

export function loadRun(file: string) {
  const contents = readFileSync(file, 'utf8');
  const fenced = contents.match(/```json\s*([\s\S]*?)```/i);
  const record = JSON.parse(fenced?.[1] ?? contents);
  if (record.schema_version !== 1) throw new RunError(`Unsupported run record version: ${file}`);
  return record;
}