import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { invoke } from '../providers.js';
import { copyWorkspace, workspaceFiles } from './workspace.js';
import { parseObject } from './parse.js';

export async function askScoped(config: any, role: string, task: any, context: string, options: { allowedPath?: (file: string) => boolean; strong?: boolean } = {}) {
  const { allowedPath = () => false, strong = false } = options;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-worker-'));
  try {
    copyWorkspace(task.repo, workspace);
    const before = workspaceFiles(workspace);
    const result = await ask(config, role, { ...task, repo: workspace }, context, { strong, skipGitRepoCheck: true });
    const after = workspaceFiles(workspace);
    const attempted = [...new Set([...before.keys(), ...after.keys()])]
      .filter((file) => before.get(file) !== after.get(file)).sort();
    const applied = attempted.filter((file) => allowedPath(file) && after.get(file) !== 'symlink');
    const discarded = attempted.filter((file) => !allowedPath(file) || after.get(file) === 'symlink');
    for (const file of applied) {
      const source = path.join(workspace, file);
      const target = path.join(task.repo, file);
      if (after.has(file)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        fs.chmodSync(target, fs.statSync(source).mode & 0o777);
      } else fs.rmSync(target, { force: true });
    }
    return { result, attempted, applied, discarded };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

export async function askReadOnly(config: any, role: string, task: any, context: string, options: any = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-readonly-'));
  try {
    copyWorkspace(task.repo, workspace);
    return await ask(config, role, { ...task, repo: workspace }, context, { ...options, skipGitRepoCheck: true });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

export async function ask(config: any, role: string, task: any, context: string, options: { strong?: boolean; skipGitRepoCheck?: boolean } = {}) {
  const { strong = false, skipGitRepoCheck = false } = options;
  const shape = task.shape ?? '{"status":"pass|fail","summary":"...","findings":[],"changed_paths":[],"commands":[]}';
  const prompt = `You are the Strata ${role}. Follow the supplied Strata specifications and role boundary.\nReturn one JSON object only, matching this shape: ${shape}\n\nTask:\n${task.text}\n\nRepository and supplied context:\n${context}`;
  const response = await invoke(strong ? config.strong : config.worker, prompt, task.repo, role, { skipGitRepoCheck });
  return parseObject(response, role);
}
