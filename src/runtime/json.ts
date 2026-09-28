import { readTree } from './tree.js';

export function json(context: any) { return JSON.stringify(context, null, 2); }
export function phaseContext(repo: string, config: any) { return readTree(repo, config.workflow.spec_paths); }