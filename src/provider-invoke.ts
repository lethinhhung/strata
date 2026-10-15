import type { AgentConfig } from './config.js';
import { run } from './provider-process.js';
import { codexText, eventSummary, openCodeText, parseEvent, providerError } from './provider-events.js';

export async function invoke(agent: AgentConfig, prompt: string, cwd: string, readOnly = false): Promise<string> {
  const effectivePrompt = agent.provider === 'opencode' ? fitPrompt(prompt, 18000) : prompt;
  const args = agent.provider === 'codex'
    ? ['exec', '--json', '--cd', cwd, '--sandbox', readOnly ? 'read-only' : 'workspace-write', '--config', 'approval_policy="never"', ...(agent.model ? ['--model', agent.model] : []), ...agent.extra_args, effectivePrompt]
    : ['run', '--format', 'json', '--dir', cwd, ...(agent.model ? ['--model', agent.model] : []), ...agent.extra_args, effectivePrompt];
  const env = agent.provider === 'opencode' && readOnly
    ? { ...process.env, OPENCODE_PERMISSION: JSON.stringify({ '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow', lsp: 'allow' }) }
    : process.env;
  const role = prompt.match(/^You are Strata's ([^.]+)\./m)?.[1] ?? `${agent.provider} agent`;
  if (effectivePrompt.length < prompt.length) console.error(`[strata] shortened ${role} prompt by ${prompt.length - effectivePrompt.length} characters to fit the OpenCode context budget`);
  const started = Date.now();
  const idleTimeout = agent.idle_timeout_seconds ?? (agent.provider === 'opencode' ? 360 : 0);
  let lastOutput = started, activity = 'no provider output yet', pending = '', invalidToolCalls = 0;
  const failedCalls = new Set<string>();
  let providerFailure: string | undefined;
  const onStdout = (chunk: Buffer) => {
    lastOutput = Date.now(); pending += chunk.toString('utf8');
    const lines = pending.split('\n'); pending = lines.pop()!.slice(-8000);
    for (const line of lines) {
      if (agent.provider === 'opencode') {
        const event = parseEvent(line);
        if (event?.type === 'error') providerFailure = providerError(event.error);
        if (event?.type === 'tool_use' && /Model tried to call unavailable tool\b/i.test(String(event.part?.state?.error ?? ''))) {
          const call = event.part.callID ?? event.part.id;
          if (!call || !failedCalls.has(call)) { if (call) failedCalls.add(call); invalidToolCalls += 1; }
          if (invalidToolCalls >= 3) providerFailure = `Model generated ${invalidToolCalls} unavailable-tool calls. Latest error: ${providerError(event.part.state.error)}`;
        }
      }
      const summary = eventSummary(line, agent.provider);
      if (summary) activity = summary;
      if (providerFailure) return providerFailure;
    }
  };
  const showTimer = Boolean(process.stderr.isTTY);
  const heartbeat = showTimer ? setInterval(() => {
    const elapsed = Math.floor((Date.now() - started) / 1000), sinceOutput = Math.floor((Date.now() - lastOutput) / 1000);
    process.stderr.write(`\r[strata] ${role} running (${elapsed}s elapsed, ${sinceOutput}s since output)\x1b[K`);
  }, 1000) : undefined;
  let result;
  try { result = await run(agent.command, args, cwd, agent.timeout_seconds * 1000, env, { idleTimeoutMs: idleTimeout * 1000, onStdout }); }
  finally { if (heartbeat) { clearInterval(heartbeat); process.stderr.write('\r\x1b[K'); } }
  if (agent.provider === 'opencode') for (const line of result.stdout.split('\n')) {
    const event = parseEvent(line);
    if (event?.type === 'error') providerFailure = providerError(event.error);
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
  const headLength = Math.floor(maxLength * 0.7), tailLength = maxLength - headLength;
  return `${prompt.slice(0, headLength)}\n\n[Strata omitted ${prompt.length - maxLength} characters of lower-priority context to fit the worker's input limit.]\n\n${prompt.slice(-tailLength)}`;
}
