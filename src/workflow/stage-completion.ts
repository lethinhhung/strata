import { checkpoint } from './checkpoint.js';

export async function completeStage(repo: string, record: any, stage: any, save: () => void) {
  await checkpoint(repo, stage);
  stage.status = 'complete';
  record.history.push({ type: 'stage_complete', stage: stage.id, at: new Date().toISOString() });
  save();
}

export function attemptFindings(attempt: any): string {
  const sections: string[] = [];
  for (const failure of attempt.implementation_failures ?? [])
    sections.push(`Implementer failure: ${String(failure)}`);
  for (const check of attempt.checks ?? []) {
    if (check.code !== 0)
      sections.push(`Check failed: ${(check.command ?? []).join(' ')}\n${String(check.output ?? '').slice(-3000)}`);
  }
  for (const role of ['tester', 'validation'] as const) {
    const result = attempt[role];
    if (!result || result.status === 'pass') continue;
    const findings = Array.isArray(result.findings) ? result.findings.map(String).join('\n- ') : '';
    sections.push(`${role} findings: ${findings || result.summary || JSON.stringify(result)}`);
  }
  if (!sections.length)
    sections.push('The previous implementation attempt did not pass. Inspect the saved attempt and verify the stage criteria against the current worktree.');
  return sections.join('\n\n').slice(-12000);
}
