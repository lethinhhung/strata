import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { invoke, ProviderError } from '../providers.js';
import { isTransientFailure } from '../providerRetry.js';
import { copyWorkspace, restoreWorkspacePaths, workspaceFiles } from './workspace.js';
import { parseObject } from './parse.js';

export async function askScoped(config: any, role: string, task: any, context: string, options: { allowedPath?: (file: string) => boolean; strong?: boolean } = {}) {
  const { allowedPath = () => false, strong = false } = options;
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-backup-'));
  try {
    copyWorkspace(task.repo, backup);
    const before = workspaceFiles(task.repo);
    let result;
    try {
      result = await ask(config, role, task, context, { strong });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = { status: 'fail', summary: message, findings: [message], changed_paths: [], commands: [] };
    }
    const after = workspaceFiles(task.repo);
    const attempted = Array.from(new Set([...Array.from(before.keys()), ...Array.from(after.keys())]))
      .filter((file) => before.get(file) !== after.get(file))
      .sort();
    const applied = attempted.filter((file) => allowedPath(file) && after.get(file) !== 'symlink');
    const discarded = attempted.filter((file) => !allowedPath(file) || after.get(file) === 'symlink');
    restoreWorkspacePaths(backup, task.repo, discarded);
    return { result, attempted, applied, discarded };
  } finally {
    fs.rmSync(backup, { recursive: true, force: true });
  }
}

export async function askReadOnly(config: any, role: string, task: any, context: string, options: any = {}) {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-backup-'));
  try {
    copyWorkspace(task.repo, backup);
    const before = workspaceFiles(task.repo);
    try {
      return await ask(config, role, task, context, options);
    } finally {
      const after = workspaceFiles(task.repo);
      const changed = Array.from(new Set([...before.keys(), ...after.keys()]))
        .filter((file) => before.get(file) !== after.get(file));
      restoreWorkspacePaths(backup, task.repo, changed);
    }
  } finally {
    fs.rmSync(backup, { recursive: true, force: true });
  }
}

export async function ask(config: any, role: string, task: any, context: string, options: { strong?: boolean; skipGitRepoCheck?: boolean } = {}) {
  const { strong = false, skipGitRepoCheck = false } = options;
  const shape = task.shape ?? '{"status":"pass|fail","summary":"...","findings":[],"changed_paths":[],"commands":[]}';
  const roleDefinition = config.roles?.[roleSlug(role)];
  const verified = role === 'Implement Agent' ? [...task.text.matchAll(/`((?:src|test)\/[^`*]+)`/g)].map((match) => match[1]).filter((file) => fs.existsSync(path.join(task.repo, file))) : [];
  const sourcePaths = verified.length ? `\nVerified existing source paths: ${verified.join(', ')}` : '';
  const projectInstructions = roleDefinition?.instructions ? `\n\nProject role definition (expertise and workflow guidance):\n${roleDefinition.instructions}` : '';
  const prompt = `You are the Strata ${role}. Your permission mode is set by this task: edit or read-only. Edit agents may change any task-relevant project files, even when role guidance prefers certain file types; read-only agents must not edit. Role definitions guide expertise and workflow, not file ownership.${projectInstructions}\nInspect the supplied repository using tools before editing or reporting file existence; verify any missing-path claim against the actual tree.${sourcePaths}\nReturn one JSON object only, matching this shape: ${shape}\n\nTask:\n${task.text}\n\nRepository and supplied context:\n${context}`;
  const model = roleDefinition?.model ?? (strong ? config.strong : config.worker);
   for (let attempt = 0; attempt < 3; attempt += 1) {
     let response: string;
     let invokeResult: { text: string; model?: string | undefined; prompt_tokens?: number | undefined; completion_tokens?: number | undefined; total_tokens?: number | undefined } | undefined;
     try {
       const result = await invoke(
         (attempt > 0 && strong || roleDefinition) ? config.strong : model,
         prompt,
         task.repo,
         role,
         { skipGitRepoCheck }
       );
       invokeResult = result;
       response = result.text;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (strong || roleDefinition || !(error instanceof ProviderError) || !isTransientFailure(message)) throw error;
        const result = await invoke(config.strong, prompt, task.repo, role, { skipGitRepoCheck });
        invokeResult = result;
        response = result.text;
      }
     try {
       const parsed = parseObject(response, role);
       // Return parsed object with telemetry fields
       return {
         ...parsed,
         model: invokeResult?.model,
         prompt_tokens: invokeResult?.prompt_tokens,
         completion_tokens: invokeResult?.completion_tokens,
         total_tokens: invokeResult?.total_tokens
       };
     } catch (error) {
       if (!(error instanceof Error) || !error.message.includes('did not return a JSON object') || attempt === 2) throw error;
       await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
     }
   }
   throw new Error(`${role} response retry limit reached`);
}

function roleSlug(role: string) {
  return role.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
