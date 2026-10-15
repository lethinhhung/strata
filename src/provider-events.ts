import type { AgentConfig } from './config.js';

export function parseEvent(line: string): any {
  try { return JSON.parse(line); } catch { return undefined; }
}

export function providerError(error: any): string {
  let message = error?.data?.message ?? error?.message ?? error?.name ?? error ?? 'Unknown provider error';
  for (let depth = 0; depth < 3 && typeof message === 'string'; depth += 1) {
    const nested = parseEvent(message);
    if (typeof nested?.message !== 'string') break;
    message = nested.message;
  }
  return String(message).replace(/[\r\n]+/g, ' ').slice(0, 400);
}

export function eventSummary(line: string, provider: AgentConfig['provider']): string | undefined {
  const event = parseEvent(line);
  if (!event) return undefined;
  if (event.type === 'error') return `provider error: ${providerError(event.error)}`;
  if (provider === 'opencode') {
    if (event.type === 'tool_use' && event.part?.tool) {
      const state = event.part.state;
      return `${event.part.tool} ${state?.status ?? 'reported'}${state?.error ? `: ${providerError(state.error)}` : ''}`;
    }
    if (event.type === 'text') return 'response text received';
    if (event.type === 'step_start') return 'model step started';
    if (event.type === 'step_finish') return `model step finished (${event.part?.reason ?? 'unknown'})`;
  } else if (event.type === 'item.completed') return `${event.item?.type ?? 'item'} completed`;
  return undefined;
}

export function codexText(output: string): string {
  const messages: string[] = [];
  for (const line of output.split('\n')) {
    const event = parseEvent(line);
    if (event?.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') messages.push(event.item.text);
    if (event?.type === 'turn.completed' && typeof event.text === 'string') messages.push(event.text);
  }
  return messages.at(-1) ?? output;
}

export function openCodeText(output: string): string {
  const messages: string[] = [];
  for (const line of output.split('\n')) {
    const item = parseEvent(line);
    if (!item) continue;
    if (item.type === 'error') throw new Error(`opencode error: ${providerError(item.error)}`);
    if (typeof item.text === 'string' && (item.type === 'text' || item.part?.type === 'text')) messages.push(item.text);
    else if (typeof item.part?.text === 'string') messages.push(item.part.text);
  }
  return messages.join('\n') || output;
}
