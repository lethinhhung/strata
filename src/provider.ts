import { spawn } from 'node:child_process';
import type { AgentConfig } from './config.js';

export async function invoke(agent: AgentConfig, prompt: string, cwd: string, readOnly = false): Promise<string> {
  const effectivePrompt = agent.provider === 'opencode' ? fitPrompt(prompt, 18000) : prompt;
  const args = agent.provider === 'codex'
    ? ['exec', '--json', '--cd', cwd, '--sandbox', readOnly ? 'read-only' : 'workspace-write', '--config', 'approval_policy="never"', ...(agent.model ? ['--model', agent.model] : []), ...agent.extra_args, effectivePrompt]
    : ['run', '--format', 'json', '--dir', cwd, ...(agent.model ? ['--model', agent.model] : []), ...agent.extra_args, effectivePrompt];
  const env = agent.provider === 'opencode' && readOnly
    ? {
        ...process.env,
        OPENCODE_PERMISSION: JSON.stringify({
          '*': 'deny',
          read: 'allow',
          glob: 'allow',
          grep: 'allow',
          list: 'allow',
          lsp: 'allow',
        }),
      }
    : process.env;
  const role = prompt.match(/^You are Strata's ([^.]+)\./m)?.[1] ?? `${agent.provider} agent`;
  if (effectivePrompt.length < prompt.length) {
    console.error(`[strata] shortened ${role} prompt by ${prompt.length - effectivePrompt.length} characters to fit the OpenCode context budget`);
  }
  const started = Date.now();
  const idleTimeout = agent.idle_timeout_seconds ?? (agent.provider === 'opencode' ? 360 : 0);
  let lastOutput = started;
  let activity = 'no provider output yet';
  let pending = '';
  let invalidToolCalls = 0;
  const failedCalls = new Set<string>();
  let providerFailure: string | undefined;
  const onStdout = (chunk: Buffer) => {
    lastOutput = Date.now();
    pending += chunk.toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop()!.slice(-8000);
    for (const line of lines) {
      if (agent.provider === 'opencode') {
        const event = parseEvent(line);
        if (event?.type === 'error') providerFailure = providerError(event.error);
        if (event?.type === 'tool_use' && /Model tried to call unavailable tool\b/i.test(String(event.part?.state?.error ?? ''))) {
          const call = event.part.callID ?? event.part.id;
          if (!call || !failedCalls.has(call)) {
            if (call) failedCalls.add(call);
            invalidToolCalls += 1;
          }
          if (invalidToolCalls >= 3) {
            providerFailure = `Model generated ${invalidToolCalls} unavailable-tool calls. Latest error: ${providerError(event.part.state.error)}`;
          }
        }
      }
      const summary = eventSummary(line, agent.provider);
      if (summary) activity = summary;
      if (providerFailure) return providerFailure;
    }
  };
  const heartbeat = setInterval(() => {
    console.error(`[strata] ${role} still running (${Math.floor((Date.now() - started) / 1000)}s elapsed, ${Math.floor((Date.now() - lastOutput) / 1000)}s since output)`);
  }, 60_000);
  let result;
  try {
    result = await run(agent.command, args, cwd, agent.timeout_seconds * 1000, env, { idleTimeoutMs: idleTimeout * 1000, onStdout });
  } finally {
    clearInterval(heartbeat);
  }
  // The provider can exit nonzero after emitting its actual error as JSON on
  // stdout. Prefer that error to a tail of unrelated tool-event transcripts.
  if (agent.provider === 'opencode') {
    for (const line of result.stdout.split('\n')) {
      const event = parseEvent(line);
      if (event?.type === 'error') providerFailure = providerError(event.error);
    }
  }
  if (providerFailure || result.aborted) throw new Error(`${agent.provider} failed (${role}): ${providerFailure ?? result.aborted}`);
  if (result.timedOut) {
    const reason = result.idleTimedOut ? `produced no output for ${idleTimeout}s` : `timed out after ${agent.timeout_seconds}s`;
    throw new Error(`${agent.provider} ${reason} (${role}; ${activity})${result.stderr.trim() ? `\n${result.stderr.slice(-1500)}` : ''}`);
  }
  if (result.code !== 0) throw new Error(`${agent.provider} exited ${result.code}: ${(result.stderr || result.stdout).slice(-3000)}`);
  const text = agent.provider === 'codex' ? codexText(result.stdout) : openCodeText(result.stdout);
  if (!text.trim()) throw new Error(`${agent.provider} returned no agent response`);
  return text;
}

function fitPrompt(prompt: string, maxLength: number): string {
  if (prompt.length <= maxLength) return prompt;
  const headLength = Math.floor(maxLength * 0.7);
  const tailLength = maxLength - headLength;
  return `${prompt.slice(0, headLength)}\n\n[Strata omitted ${prompt.length - maxLength} characters of lower-priority context to fit the worker's input limit.]\n\n${prompt.slice(-tailLength)}`;
}

export function jsonResponse(text: string): any {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); } catch { /* try embedded object */ }
  for (let start = trimmed.indexOf('{'); start >= 0; start = trimmed.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(trimmed.slice(start, index + 1)); } catch { break; }
        }
      }
    }
  }
  throw new Error(`Agent response did not contain valid JSON: ${text.slice(0, 1000)}`);
}

function codexText(output: string): string {
  const messages: string[] = [];
  for (const line of output.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') messages.push(event.item.text);
      if (event.type === 'turn.completed' && typeof event.text === 'string') messages.push(event.text);
    } catch { /* Codex can include non-JSON diagnostic lines. */ }
  }
  return messages.at(-1) ?? output;
}

function openCodeText(output: string): string {
  const messages: string[] = [];
  for (const line of output.split('\n')) {
    let item;
    try {
      item = JSON.parse(line);
    } catch { /* tolerate provider log lines */ }
    if (!item) continue;
    if (item.type === 'error') throw new Error(`opencode error: ${providerError(item.error)}`);
    if (typeof item.text === 'string' && (item.type === 'text' || item.part?.type === 'text')) messages.push(item.text);
    else if (typeof item.part?.text === 'string') messages.push(item.part.text);
  }
  return messages.join('\n') || output;
}

function providerError(error: any): string {
  let message = error?.data?.message ?? error?.message ?? error?.name ?? error ?? 'Unknown provider error';
  for (let depth = 0; depth < 3 && typeof message === 'string'; depth += 1) {
    const nested = parseEvent(message);
    if (typeof nested?.message !== 'string') break;
    message = nested.message;
  }
  return String(message).replace(/[\r\n]+/g, ' ').slice(0, 400);
}

function parseEvent(line: string): any {
  try { return JSON.parse(line); } catch { return undefined; }
}

function eventSummary(line: string, provider: AgentConfig['provider']): string | undefined {
  try {
    const event = JSON.parse(line);
    if (event.type === 'error') return `provider error: ${providerError(event.error)}`;
    if (provider === 'opencode') {
      if (event.type === 'tool_use' && event.part?.tool) {
        const state = event.part.state;
        return `${event.part.tool} ${state?.status ?? 'reported'}${state?.error ? `: ${providerError(state.error)}` : ''}`;
      }
      if (event.type === 'text') return 'response text received';
      if (event.type === 'step_start') return 'model step started';
      if (event.type === 'step_finish') return `model step finished (${event.part?.reason ?? 'unknown'})`;
    } else if (event.type === 'item.completed') {
      return `${event.item?.type ?? 'item'} completed`;
    }
  } catch { /* tolerate partial JSON and provider diagnostics */ }
  return undefined;
}

interface RunOptions {
  idleTimeoutMs?: number;
  onStdout?: (chunk: Buffer) => string | void;
}

export function run(command: string, args: string[], cwd: string, timeout: number, env: NodeJS.ProcessEnv = process.env, options: RunOptions = {}): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; idleTimedOut?: boolean; aborted?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let idleTimedOut = false;
    let aborted: string | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const terminate = (idle: boolean, failure?: string) => {
      if (settled || timedOut || aborted) return;
      timedOut = !failure;
      idleTimedOut = idle;
      aborted = failure;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      child.kill('SIGTERM');
      escalation = setTimeout(() => child.kill('SIGKILL'), 2000);
      escalation.unref();
    };
    const timer = setTimeout(() => terminate(false), timeout);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      if (!settled && !timedOut && !aborted && options.idleTimeoutMs && options.idleTimeoutMs > 0) {
        idleTimer = setTimeout(() => terminate(true), options.idleTimeoutMs);
      }
    };
    resetIdleTimer();
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
      resetIdleTimer();
      const failure = options.onStdout?.(chunk);
      if (failure) terminate(false, failure);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); clearTimeout(idleTimer); clearTimeout(escalation); reject(error); } });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      clearTimeout(escalation);
      resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), timedOut, ...(idleTimedOut ? { idleTimedOut: true } : {}), ...(aborted ? { aborted } : {}) });
    });
  });
}
