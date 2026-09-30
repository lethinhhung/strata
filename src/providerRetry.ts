export function isTransientFailure(output: string) {
  return /unexpected server error|temporarily overloaded|service unavailable|\b503\b|\b429\b|too many requests|no agent text response|getaddrinfo|unable to connect|connection (?:refused|reset)|failed to fetch models/i.test(output);
}

export function isTransientProviderEvent(line: string) {
  try {
    const event = JSON.parse(line);
    return event.type === 'error' && isTransientFailure(JSON.stringify(event.error ?? event));
  } catch { return false; }
}

export function retryDelay(attempt: number, output: string) {
  if (/no agent text response/i.test(output)) return Math.min(1_000 * 2 ** attempt, 5_000);
  const retryAfter = output.match(/retry[-_ ]after["':= ]+(\d+)/i);
  if (retryAfter) return Math.min(Number(retryAfter[1]) * 1000, 60_000);
  const base = /\b429\b|too many requests/i.test(output) ? 15_000 : 10_000;
  return Math.min(base * 2 ** attempt, 60_000);
}
