export function implementationRefusal(text: string): string | undefined {
  const patterns = [
    /\b(?:i|we) (?:could not|couldn't|cannot|can't|am unable to|are unable to) (?:complete|implement|make|perform|carry out|finish)\b/i,
    /\b(?:unable|not able) to (?:complete|implement|make|perform|carry out|finish) (?:the |this |that |requested )?(?:task|change|refactor|implementation|work)?\b/i,
    /\b(?:i|we) (?:can(?:not|'t)|cannot|don't have permission to|do not have permission to) (?:edit|modify|change|write|update|access)\b/i,
    /\b(?:the environment|this environment|the tooling|this tooling) (?:does not|doesn't) (?:provide|expose|allow) (?:a |direct )?(?:file[- ]edit|edit|write)\b/i,
    /\bplease (?:apply|make) (?:the |these |those )?(?:changes|edits|patch(?:es)?)\b/i,
    /\bif you(?:'d| would) like me to (?:apply|make|implement) (?:the |these |those )?(?:changes|edits)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return undefined;
}

export function shouldRecoverReview(result: any): boolean {
  const summary = String(result?.summary ?? '');
  const findings = Array.isArray(result?.findings) ? result.findings.join('\n') : '';
  const evidence = `${summary}\n${findings}`;
  return summary.includes('response format was invalid')
    || (result?.status === 'fail' && /unable to determine|unable to assess|cannot determine|can't determine|further investigation required|not enough information|not wrapped in act|act warning/i.test(evidence));
}
