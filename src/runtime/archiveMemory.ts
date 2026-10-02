import * as fs from 'node:fs';
import * as path from 'node:path';
import * as utils from './utils.js';
import { RunError } from './types.js';

type MemoryEntry = { class: 'decision' | 'note' | 'progress'; title: string; content: string };

export async function archiveMemory(repo: string, record: any, config: any, file: string) {
  if (record.status !== 'complete') throw new RunError(`Cannot archive memory for run ${record.run_id}: status is ${record.status}`);
  if (path.resolve(record.repository) !== path.resolve(repo)) throw new RunError('Run record belongs to a different repository');
  if (record.archival?.status === 'complete') return record.archival;

  const memoryDir = path.resolve(repo, config.workflow.memory_path);
  if (!memoryDir.startsWith(`${path.resolve(repo)}${path.sep}`)) throw new RunError('Configured memory path must remain inside the repository');
  fs.mkdirSync(memoryDir, { recursive: true });
  const realRepo = fs.realpathSync(repo);
  const realMemoryDir = fs.realpathSync(memoryDir);
  if (!realMemoryDir.startsWith(`${realRepo}${path.sep}`)) throw new RunError('Configured memory path resolves outside the repository');
  const memoryPaths = [config.workflow.memory_path, config.workflow.memory_policy].filter(Boolean);
  const current = utils.readTree(repo, memoryPaths, 24_000);
  const runSummary = {
    run_id: record.run_id,
    completed_at: record.completed_at,
    plan: record.plan,
    stages: (record.stages ?? []).map((stage: any) => ({
      id: stage.id, title: stage.title, completion_criteria: stage.completion_criteria,
      accepted_paths: stage.accepted_paths, checkpoint_commit: stage.checkpoint_commit,
      open_issues: stage.open_issues,
      phases: (stage.phase_results ?? []).map((phase: any) => ({
        phase: phase.phase,
        status: phase.result?.status,
        summary: phase.result?.summary,
        decisions: phase.result?.decisions,
        findings: phase.result?.findings,
        observed_changed_paths: phase.observed_changed_paths,
      })),
    })),
  };
  const result = await utils.askReadOnly(config, 'Archivist', {
    repo,
    shape: '{"entries":[{"class":"decision|note|progress","title":"short title","content":"entry body in repository format"}]}',
    text: `The user explicitly requested memory archival after reviewing this successful run. Read the repository memory README and existing entries directly from these paths, then propose concise reusable knowledge only: ${utils.json(memoryPaths)}. Follow the existing format for decisions.md, notes.md, and progress.md; include required affected paths and originating run link in decisions/notes. Preserve current files and let the runner append your entries. Do not write to source, specifications, tests, or policy. Do not record secrets, credentials, private user content, or raw application data. Return an empty entries array when there is no durable knowledge.\nRUN SUMMARY:\n${utils.json(runSummary)}`,
  }, utils.phaseContext(repo, config));

  const entries = (Array.isArray(result.entries) ? result.entries.slice(0, 12) : []) as MemoryEntry[];
  const files = new Map<string, string[]>();
  const queued = new Set<string>();
  const targets = { decision: 'decisions.md', note: 'notes.md', progress: 'progress.md' };
  const secretPattern = /(api[_ -]?key|secret|password|token)\s*[:=]\s*\S+/i;
  const date = utils.now().slice(0, 10);
  for (const entry of entries) {
    if (!entry || !['decision', 'note', 'progress'].includes(entry.class) || typeof entry.title !== 'string' || !entry.title.trim() || typeof entry.content !== 'string' || !entry.content.trim()) continue;
    if (entry.content.length > 6_000 || secretPattern.test(entry.content) || current.includes(entry.content.trim())) continue;
    const key = `${entry.class}\n${entry.title.trim()}\n${entry.content.trim()}`;
    if (queued.has(key)) continue;
    queued.add(key);
    const target = path.join(memoryDir, targets[entry.class]);
    files.set(target, [...(files.get(target) ?? []), `\n## ${date} — ${entry.title.trim()}\n\n${entry.content.trim()}\n`]);
  }

  const written: string[] = [];
  let writtenEntries = 0;
  for (const [target, chunks] of files) {
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new RunError(`Refusing to write memory through a symbolic link: ${path.relative(repo, target)}`);
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    const additions = chunks.filter((chunk) => !existing.includes(chunk.trim()));
    if (additions.length) {
      fs.appendFileSync(target, `\n${additions.join('\n')}\n`, 'utf8');
      written.push(path.relative(repo, target));
      writtenEntries += additions.length;
    }
  }
  const archival = { status: 'complete' as const, entries: writtenEntries, ...(written.length ? { path: written.join(', ') } : {}) };
  record.archival = archival;
  utils.save(record, file);
  return archival;
}
