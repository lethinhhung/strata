import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const runId = () => `${now().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${randomUUID().slice(0, 8)}`;
export const recordPath = (repo: string, id: string) => join(repo, 'docs', 'temps', `${id}.md`);