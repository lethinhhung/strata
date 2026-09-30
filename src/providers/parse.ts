export function parseCodexOutput(stdout: string): string {
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') messages.push(event.item.text ?? '');
      if (event.type === 'response.completed' && event.response?.output_text) messages.push(event.response.output_text);
    } catch { /* Ignore non-JSON CLI progress lines. */ }
  }
  return messages.at(-1) ?? stdout.trim();
}

export function parseOpenCodeOutput(stdout: string): string {
  const lines = stdout.trim().split(/\r?\n/);
  const parts: string[] = [];
  const diagnostics: string[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.part?.text) parts.push(event.part.text);
      else if (event.text) parts.push(event.text);
      else if (event.type === 'text' && event.content) parts.push(event.content);
    } catch { diagnostics.push(line); }
  }
  return parts.length ? parts.join('\n') : diagnostics.join('\n');
}
