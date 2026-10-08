export function parseCodexOutput(stdout: string): {
  text: string;
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} {
  const messages: string[] = [];
  let model: string | undefined;
  let prompt_tokens: number | undefined;
  let completion_tokens: number | undefined;
  let total_tokens: number | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') messages.push(event.item.text ?? '');
      if (event.type === 'response.completed' && event.response?.output_text) messages.push(event.response.output_text);
      // Parse token usage from events if available.
      if (event.type === 'response.completed' && event.response?.usage) {
        const usage = event.response.usage;
        if (usage.prompt_tokens !== undefined) prompt_tokens = usage.prompt_tokens;
        if (usage.completion_tokens !== undefined) completion_tokens = usage.completion_tokens;
        if (usage.total_tokens !== undefined) total_tokens = usage.total_tokens;
      }
      // Also check for model in response
      if (event.type === 'response.completed' && event.response?.model) {
        model = event.response.model;
      }
    } catch { /* Ignore non-JSON CLI progress lines. */ }
  }
  return {
    text: messages.at(-1) ?? stdout.trim(),
    model,
    prompt_tokens,
    completion_tokens,
    total_tokens,
  };
}

export function parseOpenCodeOutput(stdout: string): {
  text: string;
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} {
  const lines = stdout.trim().split(/\r?\n/);
  const parts: string[] = [];
  const diagnostics: string[] = [];
  let model: string | undefined;
  let prompt_tokens: number | undefined;
  let completion_tokens: number | undefined;
  let total_tokens: number | undefined;
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.part?.text) parts.push(event.part.text);
      else if (event.text) parts.push(event.text);
      else if (event.type === 'text' && event.content) parts.push(event.content);
      
      // Parse token usage from events if available.
      if (event.usage) {
        const usage = event.usage;
        if (usage.prompt_tokens !== undefined) prompt_tokens = usage.prompt_tokens;
        if (usage.completion_tokens !== undefined) completion_tokens = usage.completion_tokens;
        if (usage.total_tokens !== undefined) total_tokens = usage.total_tokens;
      }
      
      // Also check for model in response
      if (event.model) {
        model = event.model;
      }
    } catch { diagnostics.push(line); }
  }
  return {
    text: parts.length ? parts.join('\n') : diagnostics.join('\n'),
    model,
    prompt_tokens,
    completion_tokens,
    total_tokens,
  };
}
